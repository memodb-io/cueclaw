import { useState, useEffect, useCallback, useRef, memo } from 'react'
import { Box, Text } from 'ink'
import { useKeypress, KeyPriority } from './use-keypress.js'
import { keyBindings } from './key-bindings.js'
import { theme as colors } from './theme/index.js'

const DOTS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export const ThinkingIndicator = memo(function ThinkingIndicator({ onCancel }: { onCancel?: () => void }) {
  const [elapsed, setElapsed] = useState(0)
  const [frame, setFrame] = useState(0)
  const startRef = useRef(Date.now())

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
      setFrame(f => (f + 1) % DOTS.length)
    }, 80)
    return () => clearInterval(timer)
  }, [])

  useKeypress('thinking-cancel', KeyPriority.Normal, useCallback((input, key) => {
    if (keyBindings.escape(input, key) && onCancel) {
      onCancel()
      return true
    }
    return false
  }, [onCancel]))

  // Cycle through gradient colors over ~4s
  const gradient = colors.ui.gradient
  const cyclePos = (Date.now() / 4000) % 1
  const gradientIdx = Math.floor(cyclePos * gradient.length) % gradient.length
  const spinnerColor = gradient[gradientIdx] ?? colors.text.accent

  const cancelHint = onCancel ? '  (esc to cancel)' : ''

  return (
    <Box paddingX={1}>
      <Box width={2}>
        <Text color={spinnerColor}>{'✦ '}</Text>
      </Box>
      <Text color={spinnerColor}>{DOTS[frame]}</Text>
      <Text color={colors.text.secondary}> Thinking... {elapsed}s{cancelHint}</Text>
    </Box>
  )
})
