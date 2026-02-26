import React, { useState, useMemo, useReducer, useEffect, useRef } from 'react'
import { Box, Text, useStdout, useInput } from 'ink'
import { Spinner, useComponentTheme, type ComponentTheme } from '@inkjs/ui'
import { getCommands } from './commands.js'

// ─── Resettable TextInput ───
// @inkjs/ui TextInput has no way to clear after submit. This is a minimal
// controlled version using ink's useInput that supports reset.

type InputAction =
  | { type: 'insert'; text: string }
  | { type: 'delete' }
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'reset' }

interface InputState { value: string; prevValue: string; cursor: number }

function inputReducer(state: InputState, action: InputAction): InputState {
  switch (action.type) {
    case 'insert': {
      const value = state.value.slice(0, state.cursor) + action.text + state.value.slice(state.cursor)
      return { value, prevValue: state.value, cursor: state.cursor + action.text.length }
    }
    case 'delete': {
      if (state.cursor === 0) return state
      const value = state.value.slice(0, state.cursor - 1) + state.value.slice(state.cursor)
      return { value, prevValue: state.value, cursor: state.cursor - 1 }
    }
    case 'left': return { ...state, cursor: Math.max(0, state.cursor - 1) }
    case 'right': return { ...state, cursor: Math.min(state.value.length, state.cursor + 1) }
    case 'reset': return { value: '', prevValue: state.value, cursor: 0 }
  }
}

function ResettableInput({ placeholder, onSubmit, onChange, isDisabled }: {
  placeholder: string
  onSubmit: (value: string) => void
  onChange?: (value: string) => void
  isDisabled?: boolean
}) {
  const [state, dispatch] = useReducer(inputReducer, { value: '', prevValue: '', cursor: 0 })
  const submitRef = useRef<string | null>(null)

  // Fire onChange via useEffect to avoid stale closure issues
  useEffect(() => {
    if (state.value !== state.prevValue) {
      onChange?.(state.value)
    }
  }, [state.value, state.prevValue, onChange])

  // Fire onSubmit after reset
  useEffect(() => {
    if (submitRef.current !== null) {
      const value = submitRef.current
      submitRef.current = null
      onSubmit(value)
    }
  })

  useInput((input, key) => {
    if (key.upArrow || key.downArrow || (key.ctrl && input === 'c') || key.tab || (key.shift && key.tab)) return
    if (key.return) {
      submitRef.current = state.value
      dispatch({ type: 'reset' })
      return
    }
    if (key.leftArrow) { dispatch({ type: 'left' }); return }
    if (key.rightArrow) { dispatch({ type: 'right' }); return }
    if (key.backspace || key.delete) { dispatch({ type: 'delete' }); return }
    dispatch({ type: 'insert', text: input })
  }, { isActive: !isDisabled })

  if (state.value.length === 0) {
    return (
      <Text>
        <Text inverse>{placeholder?.[0] ?? ' '}</Text>
        <Text dimColor>{placeholder?.slice(1) ?? ''}</Text>
      </Text>
    )
  }

  const before = state.value.slice(0, state.cursor)
  const cursorChar = state.value[state.cursor] ?? ' '
  const after = state.value.slice(state.cursor + 1)

  return (
    <Text>
      {before}
      <Text inverse>{cursorChar}</Text>
      {after}
    </Text>
  )
}

// ─── Types ───

interface ChatMessage {
  role: 'user' | 'system' | 'assistant'
  text?: string
  content?: React.ReactNode
}

interface ChatProps {
  messages: ChatMessage[]
  isGenerating: boolean
  onSubmit: (text: string) => void
  footerExtra?: string
  footerHints?: string
  streamingText?: string
}

export function Chat({ messages, isGenerating, onSubmit, footerExtra, footerHints, streamingText }: ChatProps) {
  const { styles } = useComponentTheme<ComponentTheme>('Chat')
  const { styles: headerStyles } = useComponentTheme<ComponentTheme>('Header')
  const userStyle = styles?.userMessage?.() ?? { color: 'white', bold: true }
  const systemStyle = styles?.systemMessage?.() ?? { color: 'cyan' }
  const assistantStyle = styles?.assistantMessage?.() ?? { color: 'white' }
  const promptStyle = styles?.prompt?.() ?? { color: 'green' }
  const hintsStyle = headerStyles?.hints?.() ?? { color: 'white', dimColor: true }

  const { stdout } = useStdout()
  const cols = stdout?.columns ?? 80

  // Track current input for command hints
  const [currentInput, setCurrentInput] = useState('')

  const allCommands = useMemo(() => getCommands(), [])

  // Compute matching commands for the dropdown hint
  const matchingCommands = useMemo(() => {
    if (!currentInput.startsWith('/')) return []
    const prefix = currentInput.toLowerCase()
    return allCommands.filter(c => {
      const full = `/${c.name}`
      return full.startsWith(prefix) || c.aliases.some(a => `/${a}`.startsWith(prefix))
    })
  }, [currentInput, allCommands])

  const showCommandHints = currentInput.startsWith('/') && matchingCommands.length > 0 && currentInput !== '/'  + matchingCommands[0]?.name

  const defaultHints = 'Enter send · /help commands · Ctrl+C exit'

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Messages */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} marginTop={1}>
        {messages.map((msg, i) => (
          <Box key={i} marginBottom={1} flexDirection="column">
            {msg.role === 'user' ? (
              <Text {...userStyle}>You: {msg.text}</Text>
            ) : msg.role === 'assistant' ? (
              msg.content ? (
                <Box flexDirection="column">
                  <Text {...assistantStyle} bold>CueClaw:</Text>
                  {msg.content}
                </Box>
              ) : (
                <Text {...assistantStyle}>CueClaw: {msg.text}</Text>
              )
            ) : (
              <Text {...systemStyle}>{msg.text}</Text>
            )}
          </Box>
        ))}
        {streamingText && (
          <Box marginBottom={1}>
            <Text {...assistantStyle}>CueClaw: {streamingText}</Text>
          </Box>
        )}
        {isGenerating && !streamingText && (
          <Box>
            <Spinner label="Thinking..." />
          </Box>
        )}
      </Box>

      {/* Input */}
      {!isGenerating && (
        <Box paddingX={1}>
          <Text {...promptStyle}>{'> '}</Text>
          <ResettableInput
            placeholder="Describe a workflow or type /help"
            onChange={setCurrentInput}
            onSubmit={(value) => {
              const trimmed = value.trim()
              if (trimmed) {
                setCurrentInput('')
                onSubmit(trimmed)
              }
            }}
            isDisabled={isGenerating}
          />
        </Box>
      )}

      {/* Command hints — shown below input when typing / */}
      {!isGenerating && showCommandHints && (
        <Box flexDirection="column" paddingX={2}>
          {matchingCommands.slice(0, 6).map((cmd) => (
            <Box key={cmd.name} gap={1}>
              <Text color="cyan">/{cmd.name}</Text>
              <Text dimColor>— {cmd.description}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Separator + Hints */}
      <Box paddingX={1}>
        <Text dimColor>{'─'.repeat(Math.max(0, cols - 2))}</Text>
      </Box>
      <Box paddingX={1}>
        <Text {...hintsStyle}>{footerHints ?? defaultHints}{footerExtra ?? ''}</Text>
      </Box>
    </Box>
  )
}

export type { ChatMessage }
