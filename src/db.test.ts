import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3'
import {
  _initTestDatabase,
  insertWorkflow,
  getWorkflow,
  listWorkflows,
  updateWorkflowPhase,
  deleteWorkflow,
  insertWorkflowRun,
  getWorkflowRun,
  updateWorkflowRunStatus,
  insertStepRun,
  getStepRun,
  updateStepRunStatus,
  getStepRunsByRunId,
} from './db.js'
import type { Workflow, WorkflowRun, StepRun } from './types.js'

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'wf_test1',
    schema_version: '1.0',
    name: 'Test Workflow',
    description: 'A test workflow',
    trigger: { type: 'manual' },
    steps: [
      {
        id: 'step-1',
        description: 'Do something',
        agent: 'claude',
        inputs: {},
        depends_on: [],
      },
    ],
    failure_policy: { on_step_failure: 'stop', max_retries: 0, retry_delay_ms: 5000 },
    phase: 'planning',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('Database', () => {
  let db: Database.Database

  beforeEach(() => {
    db = _initTestDatabase()
  })

  afterEach(() => {
    db.close()
  })

  describe('schema', () => {
    it('creates all tables', () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
      const names = tables.map(t => t.name)
      expect(names).toContain('workflows')
      expect(names).toContain('workflow_runs')
      expect(names).toContain('step_runs')
      expect(names).toContain('sessions')
      expect(names).toContain('trigger_state')
    })

    it('creates indexes', () => {
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").all() as { name: string }[]
      const names = indexes.map(i => i.name)
      expect(names).toContain('idx_workflows_phase')
      expect(names).toContain('idx_workflow_runs_status')
      expect(names).toContain('idx_step_runs_run_id')
    })
  })

  describe('workflows', () => {
    it('inserts and retrieves a workflow', () => {
      const wf = makeWorkflow()
      insertWorkflow(db, wf)
      const retrieved = getWorkflow(db, wf.id)
      expect(retrieved).toBeDefined()
      expect(retrieved!.id).toBe(wf.id)
      expect(retrieved!.name).toBe(wf.name)
      expect(retrieved!.phase).toBe('planning')
      expect(retrieved!.steps).toHaveLength(1)
      expect(retrieved!.trigger).toEqual({ type: 'manual' })
    })

    it('lists workflows', () => {
      insertWorkflow(db, makeWorkflow({ id: 'wf_a', phase: 'planning' }))
      insertWorkflow(db, makeWorkflow({ id: 'wf_b', phase: 'active' }))

      const all = listWorkflows(db)
      expect(all).toHaveLength(2)

      const planning = listWorkflows(db, 'planning')
      expect(planning).toHaveLength(1)
      expect(planning[0]!.id).toBe('wf_a')
    })

    it('updates workflow phase', () => {
      insertWorkflow(db, makeWorkflow())
      updateWorkflowPhase(db, 'wf_test1', 'active')
      const updated = getWorkflow(db, 'wf_test1')
      expect(updated!.phase).toBe('active')
    })

    it('deletes a workflow', () => {
      insertWorkflow(db, makeWorkflow())
      deleteWorkflow(db, 'wf_test1')
      const deleted = getWorkflow(db, 'wf_test1')
      expect(deleted).toBeUndefined()
    })

    it('returns undefined for non-existent workflow', () => {
      const result = getWorkflow(db, 'wf_nonexistent')
      expect(result).toBeUndefined()
    })
  })

  describe('workflow runs', () => {
    it('inserts and retrieves a workflow run', () => {
      insertWorkflow(db, makeWorkflow())
      const run: WorkflowRun = {
        id: 'run_1',
        workflow_id: 'wf_test1',
        trigger_data: null,
        status: 'running',
        started_at: new Date().toISOString(),
      }
      insertWorkflowRun(db, run)

      const retrieved = getWorkflowRun(db, 'run_1')
      expect(retrieved).toBeDefined()
      expect(retrieved!.status).toBe('running')
    })

    it('updates run status', () => {
      insertWorkflow(db, makeWorkflow())
      insertWorkflowRun(db, {
        id: 'run_1',
        workflow_id: 'wf_test1',
        trigger_data: null,
        status: 'running',
        started_at: new Date().toISOString(),
      })

      updateWorkflowRunStatus(db, 'run_1', 'completed')
      const updated = getWorkflowRun(db, 'run_1')
      expect(updated!.status).toBe('completed')
      expect(updated!.completed_at).toBeDefined()
    })
  })

  describe('step runs', () => {
    beforeEach(() => {
      insertWorkflow(db, makeWorkflow())
      insertWorkflowRun(db, {
        id: 'run_1',
        workflow_id: 'wf_test1',
        trigger_data: null,
        status: 'running',
        started_at: new Date().toISOString(),
      })
    })

    it('inserts and retrieves a step run', () => {
      const stepRun: StepRun = {
        id: 'sr_1',
        run_id: 'run_1',
        step_id: 'step-1',
        status: 'pending',
      }
      insertStepRun(db, stepRun)

      const retrieved = getStepRun(db, 'sr_1')
      expect(retrieved).toBeDefined()
      expect(retrieved!.status).toBe('pending')
    })

    it('updates step run status with output', () => {
      insertStepRun(db, {
        id: 'sr_1',
        run_id: 'run_1',
        step_id: 'step-1',
        status: 'running',
        started_at: new Date().toISOString(),
      })

      updateStepRunStatus(db, 'sr_1', 'succeeded', '{"result": "done"}')
      const updated = getStepRun(db, 'sr_1')
      expect(updated!.status).toBe('succeeded')
      expect(updated!.output_json).toBe('{"result": "done"}')
      expect(updated!.completed_at).toBeDefined()
    })

    it('lists step runs by run ID', () => {
      insertStepRun(db, { id: 'sr_1', run_id: 'run_1', step_id: 'step-1', status: 'pending' })
      insertStepRun(db, { id: 'sr_2', run_id: 'run_1', step_id: 'step-2', status: 'pending' })

      const steps = getStepRunsByRunId(db, 'run_1')
      expect(steps).toHaveLength(2)
    })
  })
})
