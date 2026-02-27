import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { Box, Text, useStdout } from 'ink'
import { theme as colors } from './theme/index.js'
import { useUIState } from './ui-state-context.js'
import { useKeypress, KeyPriority } from './use-keypress.js'
import { keyBindings } from './key-bindings.js'
import { ThinkingIndicator } from './thinking-indicator.js'
import { MessageDisplay } from './messages/message-display.js'
import { useUIActions } from './ui-actions-context.js'

export function MainContent() {
  const { messages, isGenerating, streamingText } = useUIState()
  const { handleCancelGeneration } = useUIActions()
  const { stdout } = useStdout()
  const rows = stdout?.rows ?? 24

  // Scroll state (0 = bottom, positive = scrolled up by N messages)
  const [scrollOffset, setScrollOffset] = useState(0)
  const prevMessageCountRef = useRef(messages.length)

  // Auto-scroll to bottom on new messages when already at bottom
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current && scrollOffset === 0) {
      // Already at bottom, stay there
    }
    prevMessageCountRef.current = messages.length
  }, [messages.length, scrollOffset])

  // Scroll keybindings: Ctrl+P up, Ctrl+N down
  const pageSize = Math.max(1, Math.floor(rows / 2))

  useKeypress('chat-scroll', KeyPriority.Normal, useCallback((input, key) => {
    if (keyBindings.scrollUp(input, key)) {
      setScrollOffset(prev => Math.min(prev + pageSize, Math.max(0, messages.length - 1)))
      return true
    }
    if (keyBindings.scrollDown(input, key)) {
      setScrollOffset(prev => Math.max(0, prev - pageSize))
      return true
    }
    return false
  }, [pageSize, messages.length]))

  // Compute visible messages
  const visibleMessages = useMemo(() => {
    if (scrollOffset === 0) return messages
    const end = messages.length - scrollOffset
    return messages.slice(0, Math.max(0, end))
  }, [messages, scrollOffset])

  const hiddenAbove = messages.length - visibleMessages.length

  return (
    <>
      {/* Scroll indicator */}
      {hiddenAbove > 0 && (
        <Box paddingX={1}>
          <Text dimColor>^ {hiddenAbove} more message{hiddenAbove !== 1 ? 's' : ''} (Ctrl+P/Ctrl+N)</Text>
        </Box>
      )}

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1} marginTop={hiddenAbove > 0 ? 0 : 1}>
        {visibleMessages.map((msg, i) => (
          <Box key={i} marginBottom={1} flexDirection="column">
            <MessageDisplay message={msg} />
          </Box>
        ))}
        {streamingText && (
          <Box marginBottom={1} paddingX={1}>
            <Box width={2}>
              <Text color={colors.text.accent}>{'✦ '}</Text>
            </Box>
            <Box flexShrink={1}>
              <Text color={colors.text.primary}>{streamingText}</Text>
            </Box>
          </Box>
        )}
        {isGenerating && !streamingText && (
          <ThinkingIndicator onCancel={handleCancelGeneration} />
        )}
      </Box>
    </>
  )
}
