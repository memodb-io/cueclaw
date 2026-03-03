import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from 'ink-testing-library'
import { ThemeProvider } from '@inkjs/ui'
import { cueclawTheme } from './theme.js'
import { KeypressProvider } from './use-keypress.js'
import { Chat } from './chat.js'
import { UIStateContext, type UIState, type StoredMessage, type ChatMessage } from './ui-state-context.js'
import { UIActionsContext, type UIActions } from './ui-actions-context.js'

afterEach(cleanup)

let _msgId = 1
function msg(body: ChatMessage): StoredMessage {
  return { ...body, id: _msgId++ }
}

function createMockUIState(overrides: Partial<UIState> = {}): UIState {
  return {
    view: 'chat',
    messages: [],
    workflow: null,
    isGenerating: false,
    stepProgress: new Map(),
    executionOutput: [],
    streamingText: '',
    daemonStatus: 'none',
    isExecuting: false,
    config: null,
    cwd: '/test',
    footerExtra: '',
    footerHints: undefined,
    isConversing: false,
    themeVersion: 0,
    statusWorkflows: [],
    detailRuns: [],
    detailStepRuns: [],
    ...overrides,
  }
}

function createMockUIActions(overrides: Partial<UIActions> = {}): UIActions {
  return {
    handleChatSubmit: vi.fn(),
    handleCancelGeneration: vi.fn(),
    handleConfirm: vi.fn(),
    handleModify: vi.fn(),
    handleCancel: vi.fn(),
    handleExecutionAbort: vi.fn(),
    handleExecutionBack: vi.fn(),
    handleOnboardingComplete: vi.fn(),
    handleOnboardingCancel: vi.fn(),
    handleStatusBack: vi.fn(),
    handleStatusSelect: vi.fn(),
    handleStatusStop: vi.fn(),
    handleStatusDelete: vi.fn(),
    handleDetailBack: vi.fn(),
    handleDetailSelectRun: vi.fn(),
    ...overrides,
  }
}

function renderChat(stateOverrides: Partial<UIState> = {}, actionOverrides: Partial<UIActions> = {}) {
  const state = createMockUIState(stateOverrides)
  const actions = createMockUIActions(actionOverrides)
  return render(
    <ThemeProvider theme={cueclawTheme}>
      <KeypressProvider>
        <UIStateContext.Provider value={state}>
          <UIActionsContext.Provider value={actions}>
            <Chat />
          </UIActionsContext.Provider>
        </UIStateContext.Provider>
      </KeypressProvider>
    </ThemeProvider>
  )
}

describe('Chat component rendering', () => {
  it('renders empty state with prompt and hints', () => {
    const { lastFrame } = renderChat()
    const frame = lastFrame()!
    expect(frame).toContain('>')
    expect(frame).toContain('/help')
  })

  it('renders user messages with "You:" prefix', () => {
    const messages = [msg({ type: 'user', text: 'Hello world' })]
    const { lastFrame } = renderChat({ messages })
    expect(lastFrame()!).toContain('Hello world')
    expect(lastFrame()!).toContain('>')
  })

  it('renders system messages without prefix', () => {
    const messages = [msg({ type: 'system', text: 'Daemon started.' })]
    const { lastFrame } = renderChat({ messages })
    expect(lastFrame()!).toContain('Daemon started.')
  })

  it('renders assistant text messages with "CueClaw:" prefix', () => {
    const messages = [msg({ type: 'assistant', text: 'How can I help?' })]
    const { lastFrame } = renderChat({ messages })
    expect(lastFrame()!).toContain('How can I help?')
    expect(lastFrame()!).toContain('✦')
  })

  it('renders assistant messages with JSX content', () => {
    const messages = [
      msg({ type: 'assistant-jsx', content: React.createElement('ink-text', null, 'Custom content') }),
    ]
    const { lastFrame } = renderChat({ messages })
    const frame = lastFrame()!
    expect(frame).toContain('✦')
    expect(frame).toContain('Custom content')
  })

  it('renders error messages', () => {
    const messages = [msg({ type: 'error', text: 'Something went wrong' })]
    const { lastFrame } = renderChat({ messages })
    expect(lastFrame()!).toContain('Something went wrong')
  })

  it('renders warning messages', () => {
    const messages = [msg({ type: 'warning', text: 'Be careful' })]
    const { lastFrame } = renderChat({ messages })
    expect(lastFrame()!).toContain('Be careful')
  })

  it('renders plan-ready messages', () => {
    const messages = [msg({ type: 'plan-ready', workflowName: 'My Workflow' })]
    const { lastFrame } = renderChat({ messages })
    expect(lastFrame()!).toContain('My Workflow')
  })

  it('renders multiple messages in order', () => {
    const messages = [
      msg({ type: 'user', text: 'First' }),
      msg({ type: 'assistant', text: 'Second' }),
      msg({ type: 'system', text: 'Third' }),
    ]
    const { lastFrame } = renderChat({ messages })
    const frame = lastFrame()!
    const firstIdx = frame.indexOf('First')
    const secondIdx = frame.indexOf('Second')
    const thirdIdx = frame.indexOf('Third')
    expect(firstIdx).toBeLessThan(secondIdx)
    expect(secondIdx).toBeLessThan(thirdIdx)
  })

  it('shows thinking indicator with elapsed time when generating', () => {
    const { lastFrame } = renderChat({ isGenerating: true })
    const frame = lastFrame()!
    expect(frame).toContain('Thinking...')
    expect(frame).toContain('0s')
  })

  it('shows cancel hint when onCancel is provided', () => {
    const { lastFrame } = renderChat({ isGenerating: true })
    const frame = lastFrame()!
    expect(frame).toContain('esc to cancel')
  })

  it('hides input when generating', () => {
    const { lastFrame } = renderChat({ isGenerating: true })
    const frame = lastFrame()!
    expect(frame).not.toContain('Describe a workflow')
  })

  it('shows streaming text and hides spinner during streaming', () => {
    const { lastFrame } = renderChat({
      isGenerating: true,
      streamingText: 'Let me think about this...',
    })
    const frame = lastFrame()!
    expect(frame).toContain('Let me think about this...')
    expect(frame).toContain('✦')
    expect(frame).not.toContain('Thinking')
  })

  it('renders custom footer hints', () => {
    const { lastFrame } = renderChat({
      footerHints: 'Enter send \u00b7 /cancel abort',
    })
    expect(lastFrame()!).toContain('/cancel abort')
  })

  it('renders footer extra info appended to hints', () => {
    const { lastFrame } = renderChat({
      footerExtra: ' | Daemon active',
    })
    const frame = lastFrame()!
    expect(frame).toContain('Daemon active')
  })

  it('renders separator line', () => {
    const { lastFrame } = renderChat()
    const frame = lastFrame()!
    expect(frame).toContain('\u2500')
  })

  it('does not show scroll indicator when all messages visible', () => {
    const messages = [msg({ type: 'user', text: 'Hello' })]
    const { lastFrame } = renderChat({ messages })
    expect(lastFrame()!).not.toContain('more message')
  })
})
