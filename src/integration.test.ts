import { describe, it, expect, vi, beforeEach } from 'vitest'
import { _initTestDatabase, insertWorkflow, getWorkflow, listWorkflows } from './db.js'
import { executeWorkflow } from './executor.js'
import { confirmPlan, rejectPlan } from './planner.js'
import type { Workflow, PlanStep, FailurePolicy } from './types.js'
import type { StepRunResult } from './agent-runner.js'

// Mock the agent runner to return predictable results
vi.mock('./agent-runner.js', () => ({
  runAgent: vi.fn((opts: any) => {
    const stepId = opts.stepId as string

    // Simulate different outcomes based on step ID
    if (stepId === 'fail-step') {
      return {
        resultPromise: Promise.resolve({ status: 'failed', error: 'Simulated failure' } as StepRunResult),
        abort: () => {},
      }
    }

    // Default: succeed with predictable output
    return {
      resultPromise: Promise.resolve({
        status: 'succeeded',
        output: `output-from-${stepId}`,
      } as StepRunResult),
      abort: () => {},
    }
  }),
}))

function createTestWorkflow(overrides: {
  steps?: PlanStep[]
  failure_policy?: FailurePolicy
  trigger_type?: 'manual' | 'poll' | 'cron'
} = {}): Workflow {
  return {
    id: `wf_test_${Date.now()}`,
    name: 'Test Workflow',
    description: 'Integration test workflow',
    schema_version: '1.0',
    phase: 'awaiting_confirmation',
    trigger: overrides.trigger_type === 'poll'
      ? { type: 'poll', interval_seconds: 60, diff_mode: 'new_items', check_script: 'echo test' }
      : { type: 'manual' },
    steps: overrides.steps ?? [
      { id: 'step-a', description: 'First step', agent: 'claude', inputs: {}, depends_on: [] },
      { id: 'step-b', description: 'Second step', agent: 'claude', inputs: { prev: '$steps.step-a.output' }, depends_on: ['step-a'] },
      { id: 'step-c', description: 'Third step (parallel with b)', agent: 'claude', inputs: { data: '$trigger_data' }, depends_on: ['step-a'] },
    ],
    failure_policy: overrides.failure_policy ?? { on_step_failure: 'stop', max_retries: 0, retry_delay_ms: 5000 },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

describe('Integration: Executor DAG ordering', () => {
  let db: ReturnType<typeof _initTestDatabase>

  beforeEach(() => {
    db = _initTestDatabase()
    vi.clearAllMocks()
  })

  it('executes steps in correct DAG order', async () => {
    const workflow = createTestWorkflow()
    insertWorkflow(db, workflow)
    const confirmed = confirmPlan(workflow)

    const result = await executeWorkflow({
      workflow: confirmed,
      triggerData: 'issue-42',
      db,
      cwd: '/tmp',
    })

    expect(result.status).toBe('completed')
    expect(result.results.size).toBe(3)
    expect(result.results.get('step-a')?.status).toBe('succeeded')
    expect(result.results.get('step-b')?.status).toBe('succeeded')
    expect(result.results.get('step-c')?.status).toBe('succeeded')
  })

  it('resolves $steps.{id}.output references', async () => {
    const { runAgent } = await import('./agent-runner.js')
    const workflow = createTestWorkflow()
    insertWorkflow(db, workflow)
    const confirmed = confirmPlan(workflow)

    await executeWorkflow({
      workflow: confirmed,
      triggerData: null,
      db,
      cwd: '/tmp',
    })

    // Verify step-b received resolved input from step-a
    const calls = vi.mocked(runAgent).mock.calls
    const stepBCall = calls.find(c => c[0].stepId === 'step-b')
    expect(stepBCall).toBeDefined()
    expect(stepBCall![0].prompt).toContain('output-from-step-a')
  })

  it('resolves $trigger_data in step inputs', async () => {
    const { runAgent } = await import('./agent-runner.js')
    const workflow = createTestWorkflow()
    insertWorkflow(db, workflow)
    const confirmed = confirmPlan(workflow)

    await executeWorkflow({
      workflow: confirmed,
      triggerData: 'Issue #42: Add login feature',
      db,
      cwd: '/tmp',
    })

    // Verify step-c received trigger data
    const calls = vi.mocked(runAgent).mock.calls
    const stepCCall = calls.find(c => c[0].stepId === 'step-c')
    expect(stepCCall).toBeDefined()
    expect(stepCCall![0].prompt).toContain('Issue #42: Add login feature')
  })
})

describe('Integration: Failure policy', () => {
  let db: ReturnType<typeof _initTestDatabase>

  beforeEach(() => {
    db = _initTestDatabase()
    vi.clearAllMocks()
  })

  it('stops execution on step failure with stop policy', async () => {
    const workflow = createTestWorkflow({
      steps: [
        { id: 'fail-step', description: 'Will fail', agent: 'claude', inputs: {}, depends_on: [] },
        { id: 'step-after', description: 'Should be skipped', agent: 'claude', inputs: {}, depends_on: ['fail-step'] },
      ],
      failure_policy: { on_step_failure: 'stop', max_retries: 0, retry_delay_ms: 0 },
    })
    insertWorkflow(db, workflow)
    const confirmed = confirmPlan(workflow)

    const result = await executeWorkflow({
      workflow: confirmed,
      triggerData: null,
      db,
      cwd: '/tmp',
    })

    expect(result.status).toBe('failed')
    expect(result.results.get('fail-step')?.status).toBe('failed')
    expect(result.results.get('step-after')?.status).toBe('skipped')
  })

  it('skips dependents on failure with skip_dependents policy', async () => {
    const workflow = createTestWorkflow({
      steps: [
        { id: 'fail-step', description: 'Will fail', agent: 'claude', inputs: {}, depends_on: [] },
        { id: 'independent', description: 'No deps on fail', agent: 'claude', inputs: {}, depends_on: [] },
        { id: 'dependent', description: 'Depends on fail', agent: 'claude', inputs: {}, depends_on: ['fail-step'] },
      ],
      failure_policy: { on_step_failure: 'skip_dependents', max_retries: 0, retry_delay_ms: 0 },
    })
    insertWorkflow(db, workflow)
    const confirmed = confirmPlan(workflow)

    const result = await executeWorkflow({
      workflow: confirmed,
      triggerData: null,
      db,
      cwd: '/tmp',
    })

    expect(result.results.get('fail-step')?.status).toBe('failed')
    expect(result.results.get('independent')?.status).toBe('succeeded')
    expect(result.results.get('dependent')?.status).toBe('skipped')
  })

  it('retries failed step when ask_user returns retry', async () => {
    const { runAgent } = await import('./agent-runner.js')
    const callCounts = new Map<string, number>()
    vi.mocked(runAgent).mockImplementation((opts: any) => {
      const stepId = opts.stepId as string
      const count = (callCounts.get(stepId) ?? 0) + 1
      callCounts.set(stepId, count)

      if (stepId === 'flaky-step' && count === 1) {
        return {
          resultPromise: Promise.resolve({ status: 'failed', error: 'first attempt failed' } as StepRunResult),
          abort: () => {},
        }
      }

      return {
        resultPromise: Promise.resolve({
          status: 'succeeded',
          output: `output-from-${stepId}-attempt-${count}`,
        } as StepRunResult),
        abort: () => {},
      }
    })

    const workflow = createTestWorkflow({
      steps: [
        { id: 'flaky-step', description: 'Flaky step', agent: 'claude', inputs: {}, depends_on: [] },
        { id: 'after-retry', description: 'Runs after retry', agent: 'claude', inputs: {}, depends_on: ['flaky-step'] },
      ],
      failure_policy: { on_step_failure: 'ask_user', max_retries: 0, retry_delay_ms: 0 },
    })
    insertWorkflow(db, workflow)
    const confirmed = confirmPlan(workflow)
    const onStepFailure = vi.fn().mockResolvedValue('retry')

    const result = await executeWorkflow({
      workflow: confirmed,
      triggerData: null,
      db,
      cwd: '/tmp',
      onStepFailure,
    })

    expect(result.status).toBe('completed')
    expect(result.results.get('flaky-step')?.status).toBe('succeeded')
    expect(result.results.get('after-retry')?.status).toBe('succeeded')
    expect(onStepFailure).toHaveBeenCalledTimes(1)
    expect(callCounts.get('flaky-step')).toBe(2)
  })

  it('calls ask_user for each failed step in same batch', async () => {
    const { runAgent } = await import('./agent-runner.js')
    vi.mocked(runAgent).mockImplementation((opts: any) => {
      const stepId = opts.stepId as string
      if (stepId.startsWith('fail-')) {
        return {
          resultPromise: Promise.resolve({ status: 'failed', error: `${stepId} failed` } as StepRunResult),
          abort: () => {},
        }
      }
      return {
        resultPromise: Promise.resolve({ status: 'succeeded', output: `ok-${stepId}` } as StepRunResult),
        abort: () => {},
      }
    })

    const workflow = createTestWorkflow({
      steps: [
        { id: 'fail-a', description: 'fail a', agent: 'claude', inputs: {}, depends_on: [] },
        { id: 'fail-b', description: 'fail b', agent: 'claude', inputs: {}, depends_on: [] },
      ],
      failure_policy: { on_step_failure: 'ask_user', max_retries: 0, retry_delay_ms: 0 },
    })
    insertWorkflow(db, workflow)
    const confirmed = confirmPlan(workflow)
    const onStepFailure = vi.fn().mockResolvedValue('skip')

    const result = await executeWorkflow({
      workflow: confirmed,
      triggerData: null,
      db,
      cwd: '/tmp',
      onStepFailure,
    })

    expect(result.status).toBe('completed')
    expect(result.results.get('fail-a')?.status).toBe('failed')
    expect(result.results.get('fail-b')?.status).toBe('failed')
    expect(onStepFailure).toHaveBeenCalledTimes(2)
  })
})

describe('Integration: Plan confirmation flow', () => {
  let db: ReturnType<typeof _initTestDatabase>

  beforeEach(() => {
    db = _initTestDatabase()
  })

  it('confirmPlan transitions manual workflow to executing', () => {
    const workflow = createTestWorkflow()
    insertWorkflow(db, workflow)

    const confirmed = confirmPlan(workflow)
    expect(confirmed.phase).toBe('executing')
  })

  it('confirmPlan transitions poll workflow to active', () => {
    const workflow = createTestWorkflow({ trigger_type: 'poll' })
    insertWorkflow(db, workflow)

    const confirmed = confirmPlan(workflow)
    expect(confirmed.phase).toBe('active')
  })

  it('rejectPlan transitions workflow back to planning', () => {
    const workflow = createTestWorkflow()
    insertWorkflow(db, workflow)

    const rejected = rejectPlan(workflow)
    expect(rejected.phase).toBe('planning')
  })
})

describe('Integration: DB persistence', () => {
  let db: ReturnType<typeof _initTestDatabase>

  beforeEach(() => {
    db = _initTestDatabase()
    vi.clearAllMocks()
  })

  it('persists workflow run and step runs to DB', async () => {
    const workflow = createTestWorkflow({
      steps: [
        { id: 'only-step', description: 'Single step', agent: 'claude', inputs: {}, depends_on: [] },
      ],
    })
    insertWorkflow(db, workflow)
    const confirmed = confirmPlan(workflow)

    const result = await executeWorkflow({
      workflow: confirmed,
      triggerData: 'test-data',
      db,
      cwd: '/tmp',
    })

    // Check workflow run in DB
    const runs = db.prepare('SELECT * FROM workflow_runs WHERE workflow_id = ?').all(workflow.id) as any[]
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('completed')
    expect(runs[0].trigger_data).toBe('test-data')

    // Check step run in DB
    const stepRuns = db.prepare('SELECT * FROM step_runs WHERE run_id = ?').all(result.runId) as any[]
    expect(stepRuns.length).toBeGreaterThanOrEqual(1)

    // Check workflow phase updated
    const wf = getWorkflow(db, workflow.id)
    expect(wf?.phase).toBe('completed') // manual trigger → completed after run
  })

  it('workflow survives full lifecycle', async () => {
    const workflow = createTestWorkflow()
    insertWorkflow(db, workflow)

    // List workflows
    const workflows = listWorkflows(db)
    expect(workflows.length).toBeGreaterThanOrEqual(1)
    expect(workflows.find(w => w.id === workflow.id)).toBeDefined()

    // Confirm
    const confirmed = confirmPlan(workflow)

    // Execute
    await executeWorkflow({
      workflow: confirmed,
      triggerData: null,
      db,
      cwd: '/tmp',
    })

    // Verify final state
    const finalWf = getWorkflow(db, workflow.id)
    expect(finalWf?.phase).toBe('completed')
  })
})
