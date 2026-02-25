import { describe, it, expect } from 'vitest'
import { confirmPlan, rejectPlan } from './planner.js'
import type { Workflow } from './types.js'

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'wf_test1',
    schema_version: '1.0',
    name: 'Test Workflow',
    description: 'A test',
    trigger: { type: 'manual' },
    steps: [{ id: 'step-1', description: 'Do thing', agent: 'claude', inputs: {}, depends_on: [] }],
    failure_policy: { on_step_failure: 'stop', max_retries: 0, retry_delay_ms: 5000 },
    phase: 'awaiting_confirmation',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('confirmPlan', () => {
  it('transitions manual trigger to executing', () => {
    const wf = makeWorkflow({ trigger: { type: 'manual' } })
    const confirmed = confirmPlan(wf)
    expect(confirmed.phase).toBe('executing')
  })

  it('transitions poll trigger to active', () => {
    const wf = makeWorkflow({
      trigger: { type: 'poll', interval_seconds: 60, check_script: 'echo ok', diff_mode: 'any_change' },
    })
    const confirmed = confirmPlan(wf)
    expect(confirmed.phase).toBe('active')
  })

  it('transitions cron trigger to active', () => {
    const wf = makeWorkflow({
      trigger: { type: 'cron', expression: '0 * * * *' },
    })
    const confirmed = confirmPlan(wf)
    expect(confirmed.phase).toBe('active')
  })

  it('throws if not in awaiting_confirmation phase', () => {
    const wf = makeWorkflow({ phase: 'planning' })
    expect(() => confirmPlan(wf)).toThrow('Cannot confirm')
  })
})

describe('rejectPlan', () => {
  it('transitions back to planning', () => {
    const wf = makeWorkflow()
    const rejected = rejectPlan(wf)
    expect(rejected.phase).toBe('planning')
  })
})
