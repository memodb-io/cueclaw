import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from 'ink-testing-library'
import { WorkflowTable, WorkflowDetail } from './renderers.js'
import type { Workflow, StepRun } from '../types.js'

afterEach(cleanup)

function makeWorkflow(overrides?: Partial<Workflow>): Workflow {
  const now = new Date().toISOString()
  return {
    id: 'wf_test123',
    name: 'Test Workflow',
    description: 'A test workflow',
    schema_version: '1.0',
    phase: 'active',
    trigger: { type: 'manual' },
    steps: [
      { id: 'step-1', description: 'Do step 1', agent: 'claude', inputs: {}, depends_on: [] },
      { id: 'step-2', description: 'Do step 2', agent: 'claude', inputs: {}, depends_on: ['step-1'] },
    ],
    failure_policy: { on_step_failure: 'stop', max_retries: 0, retry_delay_ms: 0 },
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

describe('WorkflowTable', () => {
  it('renders empty state', () => {
    const { lastFrame } = render(<WorkflowTable workflows={[]} />)
    expect(lastFrame()!).toContain('No workflows found')
  })

  it('renders workflow rows with columns', () => {
    const wf = makeWorkflow()
    const { lastFrame } = render(<WorkflowTable workflows={[wf]} />)
    const frame = lastFrame()!
    expect(frame).toContain('ID')
    expect(frame).toContain('Name')
    expect(frame).toContain('Phase')
    expect(frame).toContain('Test Workflow')
    expect(frame).toContain('active')
    expect(frame).toContain('manual')
  })

  it('renders multiple workflows', () => {
    const wf1 = makeWorkflow({ id: 'wf_aaa', name: 'First' })
    const wf2 = makeWorkflow({ id: 'wf_bbb', name: 'Second', phase: 'completed' })
    const { lastFrame } = render(<WorkflowTable workflows={[wf1, wf2]} />)
    const frame = lastFrame()!
    expect(frame).toContain('First')
    expect(frame).toContain('Second')
    expect(frame).toContain('completed')
  })

  it('renders poll trigger info', () => {
    const wf = makeWorkflow({
      trigger: { type: 'poll', interval_seconds: 60, check_script: 'echo test', diff_mode: 'new_items' },
    })
    const { lastFrame } = render(<WorkflowTable workflows={[wf]} />)
    expect(lastFrame()!).toContain('poll')
  })

  it('shows management hint', () => {
    const wf = makeWorkflow()
    const { lastFrame } = render(<WorkflowTable workflows={[wf]} />)
    expect(lastFrame()!).toContain('/status')
  })
})

describe('WorkflowDetail', () => {
  it('renders workflow info', () => {
    const wf = makeWorkflow()
    const { lastFrame } = render(<WorkflowDetail workflow={wf} />)
    const frame = lastFrame()!
    expect(frame).toContain('Test Workflow')
    expect(frame).toContain('wf_test123')
    expect(frame).toContain('active')
    expect(frame).toContain('Steps:')
    expect(frame).toContain('step-1')
    expect(frame).toContain('step-2')
  })

  it('shows step dependencies', () => {
    const wf = makeWorkflow()
    const { lastFrame } = render(<WorkflowDetail workflow={wf} />)
    expect(lastFrame()!).toContain('after: step-1')
  })

  it('renders latest run info', () => {
    const wf = makeWorkflow()
    const { lastFrame } = render(
      <WorkflowDetail
        workflow={wf}
        latestRun={{ status: 'completed', started_at: '2024-01-01T00:00:00Z' }}
      />
    )
    const frame = lastFrame()!
    expect(frame).toContain('Latest Run')
    expect(frame).toContain('completed')
  })

  it('renders run error', () => {
    const wf = makeWorkflow()
    const { lastFrame } = render(
      <WorkflowDetail
        workflow={wf}
        latestRun={{ status: 'failed', started_at: '2024-01-01', error: 'timeout' }}
      />
    )
    expect(lastFrame()!).toContain('timeout')
  })

  it('renders step run results', () => {
    const wf = makeWorkflow()
    const stepRuns: StepRun[] = [
      { id: 'sr1', run_id: 'r1', step_id: 'step-1', status: 'succeeded', output_json: 'done' },
    ]
    const { lastFrame } = render(
      <WorkflowDetail
        workflow={wf}
        latestRun={{ status: 'completed', started_at: '2024-01-01' }}
        stepRuns={stepRuns}
      />
    )
    const frame = lastFrame()!
    expect(frame).toContain('step-1')
    expect(frame).toContain('succeeded')
  })

  it('renders trigger type', () => {
    const wf = makeWorkflow({
      trigger: { type: 'cron', expression: '0 * * * *' },
    })
    const { lastFrame } = render(<WorkflowDetail workflow={wf} />)
    expect(lastFrame()!).toContain('cron')
    expect(lastFrame()!).toContain('0 * * * *')
  })
})
