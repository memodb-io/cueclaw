import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3'
import { _initTestDatabase, insertWorkflow, insertWorkflowRun, insertStepRun } from './db.js'
import { createSession, getActiveSession, deactivateSession, updateSessionSdkId } from './session.js'
import type { Workflow, WorkflowRun, StepRun } from './types.js'

describe('Session Management', () => {
  let db: Database.Database

  beforeEach(() => {
    db = _initTestDatabase()
    // Insert required parent records
    const wf: Workflow = {
      id: 'wf_1', schema_version: '1.0', name: 'Test', description: 'Test',
      trigger: { type: 'manual' }, steps: [{ id: 's1', description: 'step', agent: 'claude', inputs: {}, depends_on: [] }],
      failure_policy: { on_step_failure: 'stop', max_retries: 0, retry_delay_ms: 5000 },
      phase: 'executing', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }
    insertWorkflow(db, wf)
    const run: WorkflowRun = { id: 'run_1', workflow_id: 'wf_1', trigger_data: null, status: 'running', started_at: new Date().toISOString() }
    insertWorkflowRun(db, run)
    const sr: StepRun = { id: 'sr_1', run_id: 'run_1', step_id: 's1', status: 'running', started_at: new Date().toISOString() }
    insertStepRun(db, sr)
  })

  afterEach(() => db.close())

  it('creates a session', () => {
    const session = createSession(db, 'sr_1', 'sdk-123')
    expect(session.id).toMatch(/^sess_/)
    expect(session.step_run_id).toBe('sr_1')
    expect(session.sdk_session_id).toBe('sdk-123')
    expect(session.is_active).toBe(true)
  })

  it('retrieves active session', () => {
    createSession(db, 'sr_1', 'sdk-123')
    const active = getActiveSession(db, 'sr_1')
    expect(active).toBeDefined()
    expect(active!.sdk_session_id).toBe('sdk-123')
    expect(active!.is_active).toBe(true)
  })

  it('returns undefined when no active session', () => {
    expect(getActiveSession(db, 'sr_1')).toBeUndefined()
  })

  it('deactivates a session', () => {
    const session = createSession(db, 'sr_1', 'sdk-123')
    deactivateSession(db, session.id)
    expect(getActiveSession(db, 'sr_1')).toBeUndefined()
  })

  it('updates SDK session ID', () => {
    const session = createSession(db, 'sr_1')
    expect(session.sdk_session_id).toBeUndefined()

    updateSessionSdkId(db, session.id, 'sdk-456')
    const active = getActiveSession(db, 'sr_1')
    expect(active!.sdk_session_id).toBe('sdk-456')
  })
})
