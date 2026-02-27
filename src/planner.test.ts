import { describe, it, expect } from 'vitest'
import { confirmPlan, rejectPlan, buildPlannerSystemPrompt } from './planner.js'
import type { Workflow, ChannelContext } from './types.js'
import type { CueclawConfig } from './config.js'

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

describe('buildPlannerSystemPrompt', () => {
  const config = {
    claude: { planner: { model: 'test' }, executor: { model: 'test' } },
  } as CueclawConfig

  it('includes bot channel context with chat ID and sender', () => {
    const ctx: ChannelContext = { channel: 'telegram', chatJid: 'chat_123', sender: 'user_456' }
    const prompt = buildPlannerSystemPrompt(config, ctx)
    expect(prompt).toContain('telegram')
    expect(prompt).toContain('chat_123')
    expect(prompt).toContain('user_456')
    expect(prompt).not.toContain('No chat recipient')
  })

  it('includes TUI context instructing to require explicit recipient', () => {
    const ctx: ChannelContext = { channel: 'tui' }
    const prompt = buildPlannerSystemPrompt(config, ctx)
    expect(prompt).toContain('TUI')
    expect(prompt).toContain('explicit recipient')
    expect(prompt).not.toContain('Chat ID:')
  })

  it('defaults to TUI context when no channelContext is provided', () => {
    const prompt = buildPlannerSystemPrompt(config)
    expect(prompt).toContain('TUI')
    expect(prompt).toContain('explicit recipient')
  })
})
