import React, { useState, useMemo } from 'react'
import { Box, Text, useStdout } from 'ink'
import { TextInput, Spinner, useComponentTheme, type ComponentTheme } from '@inkjs/ui'
import { getCommands } from './commands.js'

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

  // Build suggestions list for TextInput autocomplete
  const allCommands = useMemo(() => getCommands(), [])
  const suggestions = useMemo(() => {
    return allCommands.map(c => `/${c.name}`)
  }, [allCommands])

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

      {/* Command hints dropdown — shown above input when typing / */}
      {!isGenerating && showCommandHints && (
        <Box flexDirection="column" paddingX={1} marginBottom={0}>
          <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
            {matchingCommands.slice(0, 8).map((cmd) => (
              <Box key={cmd.name} gap={1}>
                <Text color="cyan" bold>/{cmd.name}</Text>
                <Text dimColor>{cmd.usage !== `/${cmd.name}` ? cmd.usage.replace(`/${cmd.name}`, '').trim() + ' ' : ''}</Text>
                <Text dimColor>— {cmd.description}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Input */}
      {!isGenerating && (
        <Box paddingX={1}>
          <Text {...promptStyle}>{'> '}</Text>
          <TextInput
            placeholder="Describe a workflow or type /help"
            suggestions={suggestions}
            onChange={setCurrentInput}
            onSubmit={(value) => {
              const trimmed = value.trim()
              if (trimmed) {
                setCurrentInput('')
                onSubmit(trimmed)
              }
            }}
          />
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
