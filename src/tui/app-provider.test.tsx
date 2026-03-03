import { describe, it, expect } from 'vitest'
import { appReducer } from './app-provider.js'
import type { StepProgress } from './execution-view.js'
import type { View } from './ui-state-context.js'

function createInitialState() {
  return {
    view: 'chat' as const,
    previousView: null as View | null,
    messages: [],
    workflow: null,
    isGenerating: false,
    stepProgress: new Map<string, StepProgress>(),
    executionOutput: [],
    streamingText: '',
    statusWorkflows: [],
    detailRuns: [],
    detailStepRuns: [],
  }
}

describe('appReducer', () => {
  it('handles SHOW_CHAT', () => {
    const state = { ...createInitialState(), view: 'plan' as const }
    const result = appReducer(state, { type: 'SHOW_CHAT' })
    expect(result.view).toBe('chat')
  })

  it('handles SHOW_ONBOARDING', () => {
    const state = createInitialState()
    const result = appReducer(state, { type: 'SHOW_ONBOARDING' })
    expect(result.view).toBe('onboarding')
  })

  it('handles SHOW_PLAN with workflow', () => {
    const state = createInitialState()
    const workflow = { id: 'test', name: 'Test' } as any
    const result = appReducer(state, { type: 'SHOW_PLAN', workflow })
    expect(result.view).toBe('plan')
    expect(result.workflow).toBe(workflow)
  })

  it('handles SHOW_EXECUTION with workflow and resets progress', () => {
    const state = {
      ...createInitialState(),
      stepProgress: new Map([['s1', { stepId: 's1', status: 'succeeded' as const }]]),
      executionOutput: ['old output'],
    }
    const workflow = { id: 'test', name: 'Test' } as any
    const result = appReducer(state, { type: 'SHOW_EXECUTION', workflow })
    expect(result.view).toBe('execution')
    expect(result.workflow).toBe(workflow)
    expect(result.stepProgress.size).toBe(0)
    expect(result.executionOutput).toEqual([])
  })

  it('handles ADD_MESSAGE', () => {
    const state = createInitialState()
    const message = { type: 'user' as const, text: 'Hello', id: 42 }
    const result = appReducer(state, { type: 'ADD_MESSAGE', message })
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]!.type).toBe('user')
    expect(result.messages[0]!.id).toBe(42)
  })

  it('handles SET_MESSAGES', () => {
    const state = {
      ...createInitialState(),
      messages: [{ type: 'user' as const, text: 'old', id: 1 }],
    }
    const messages = [{ type: 'assistant' as const, text: 'new', id: 2 }]
    const result = appReducer(state, { type: 'SET_MESSAGES', messages })
    expect(result.messages).toBe(messages)
  })

  it('handles SET_GENERATING', () => {
    const state = createInitialState()
    const result = appReducer(state, { type: 'SET_GENERATING', value: true })
    expect(result.isGenerating).toBe(true)
  })

  it('handles SET_STREAMING_TEXT', () => {
    const state = createInitialState()
    const result = appReducer(state, { type: 'SET_STREAMING_TEXT', text: 'streaming...' })
    expect(result.streamingText).toBe('streaming...')
  })

  it('handles UPDATE_STEP', () => {
    const state = createInitialState()
    const progress = { stepId: 's1', status: 'running' as const }
    const result = appReducer(state, { type: 'UPDATE_STEP', stepId: 's1', progress })
    expect(result.stepProgress.get('s1')).toBe(progress)
  })

  it('handles ADD_OUTPUT', () => {
    const state = createInitialState()
    const result = appReducer(state, { type: 'ADD_OUTPUT', line: 'output line' })
    expect(result.executionOutput).toEqual(['output line'])
  })

  it('handles SHOW_DETAIL with workflow, runs, and stepRuns', () => {
    const state = createInitialState()
    const workflow = { id: 'test', name: 'Test' } as any
    const runs = [{ id: 'r1', workflow_id: 'test', status: 'completed' }] as any[]
    const stepRuns = [{ id: 'sr1', run_id: 'r1', step_id: 's1', status: 'succeeded' }] as any[]
    const result = appReducer(state, { type: 'SHOW_DETAIL', workflow, runs, stepRuns })
    expect(result.view).toBe('detail')
    expect(result.workflow).toBe(workflow)
    expect(result.detailRuns).toBe(runs)
    expect(result.detailStepRuns).toBe(stepRuns)
    expect(result.previousView).toBe('chat')
  })

  it('handles SHOW_STATUS with workflows', () => {
    const state = createInitialState()
    const workflows = [{ id: 'w1', name: 'Test' }] as any[]
    const result = appReducer(state, { type: 'SHOW_STATUS', workflows })
    expect(result.view).toBe('status')
    expect(result.statusWorkflows).toBe(workflows)
  })

  it('resets isGenerating on SHOW_CHAT', () => {
    const state = { ...createInitialState(), isGenerating: true, streamingText: 'partial' }
    const result = appReducer(state, { type: 'SHOW_CHAT' })
    expect(result.isGenerating).toBe(false)
    expect(result.streamingText).toBe('')
  })

  it('resets isGenerating on SHOW_PLAN', () => {
    const state = { ...createInitialState(), isGenerating: true, streamingText: 'partial' }
    const workflow = { id: 'test', name: 'Test' } as any
    const result = appReducer(state, { type: 'SHOW_PLAN', workflow })
    expect(result.isGenerating).toBe(false)
    expect(result.streamingText).toBe('')
  })

  it('resets isGenerating on SHOW_EXECUTION', () => {
    const state = { ...createInitialState(), isGenerating: true, streamingText: 'partial' }
    const workflow = { id: 'test', name: 'Test' } as any
    const result = appReducer(state, { type: 'SHOW_EXECUTION', workflow })
    expect(result.isGenerating).toBe(false)
    expect(result.streamingText).toBe('')
  })

  it('resets isGenerating on SHOW_STATUS', () => {
    const state = { ...createInitialState(), isGenerating: true, streamingText: 'partial' }
    const result = appReducer(state, { type: 'SHOW_STATUS', workflows: [] })
    expect(result.isGenerating).toBe(false)
    expect(result.streamingText).toBe('')
  })

  it('resets isGenerating on SHOW_ONBOARDING', () => {
    const state = { ...createInitialState(), isGenerating: true, streamingText: 'partial' }
    const result = appReducer(state, { type: 'SHOW_ONBOARDING' })
    expect(result.isGenerating).toBe(false)
    expect(result.streamingText).toBe('')
  })

  it('returns same state for unknown action', () => {
    const state = createInitialState()
    const result = appReducer(state, { type: 'UNKNOWN' } as any)
    expect(result).toBe(state)
  })
})
