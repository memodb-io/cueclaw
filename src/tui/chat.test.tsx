import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from 'ink-testing-library'
import { ThemeProvider } from '@inkjs/ui'
import { cueclawTheme } from './theme.js'
import { Chat, type ChatMessage } from './chat.js'

afterEach(cleanup)

function renderChat(props: Partial<React.ComponentProps<typeof Chat>> = {}) {
  const defaults = {
    messages: [] as ChatMessage[],
    isGenerating: false,
    onSubmit: vi.fn(),
  }
  return render(
    <ThemeProvider theme={cueclawTheme}>
      <Chat {...defaults} {...props} />
    </ThemeProvider>
  )
}

describe('Chat component rendering', () => {
  it('renders empty state with prompt and hints', () => {
    const { lastFrame } = renderChat()
    const frame = lastFrame()!
    expect(frame).toContain('>')
    expect(frame).toContain('/help')
    expect(frame).toContain('Ctrl+C')
  })

  it('renders user messages with "You:" prefix', () => {
    const messages: ChatMessage[] = [
      { role: 'user', text: 'Hello world' },
    ]
    const { lastFrame } = renderChat({ messages })
    expect(lastFrame()!).toContain('You: Hello world')
  })

  it('renders system messages without prefix', () => {
    const messages: ChatMessage[] = [
      { role: 'system', text: 'Daemon started.' },
    ]
    const { lastFrame } = renderChat({ messages })
    expect(lastFrame()!).toContain('Daemon started.')
  })

  it('renders assistant text messages with "CueClaw:" prefix', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', text: 'How can I help?' },
    ]
    const { lastFrame } = renderChat({ messages })
    expect(lastFrame()!).toContain('CueClaw: How can I help?')
  })

  it('renders assistant messages with JSX content', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: React.createElement('ink-text', null, 'Custom content'),
      },
    ]
    const { lastFrame } = renderChat({ messages })
    const frame = lastFrame()!
    expect(frame).toContain('CueClaw:')
    expect(frame).toContain('Custom content')
  })

  it('renders multiple messages in order', () => {
    const messages: ChatMessage[] = [
      { role: 'user', text: 'First' },
      { role: 'assistant', text: 'Second' },
      { role: 'system', text: 'Third' },
    ]
    const { lastFrame } = renderChat({ messages })
    const frame = lastFrame()!
    const firstIdx = frame.indexOf('First')
    const secondIdx = frame.indexOf('Second')
    const thirdIdx = frame.indexOf('Third')
    expect(firstIdx).toBeLessThan(secondIdx)
    expect(secondIdx).toBeLessThan(thirdIdx)
  })

  it('shows spinner with "Thinking..." when generating', () => {
    const { lastFrame } = renderChat({ isGenerating: true })
    const frame = lastFrame()!
    expect(frame).toContain('Thinking')
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
    expect(frame).toContain('CueClaw: Let me think about this...')
    expect(frame).not.toContain('Thinking')
  })

  it('renders custom footer hints', () => {
    const { lastFrame } = renderChat({
      footerHints: 'Enter send · /cancel abort',
    })
    expect(lastFrame()!).toContain('/cancel abort')
  })

  it('renders footer extra info appended to hints', () => {
    const { lastFrame } = renderChat({
      footerExtra: ' | Daemon active',
    })
    const frame = lastFrame()!
    expect(frame).toContain('Daemon active')
    expect(frame).toContain('/help') // default hints still present
  })

  it('renders separator line', () => {
    const { lastFrame } = renderChat()
    const frame = lastFrame()!
    expect(frame).toContain('─')
  })
})
