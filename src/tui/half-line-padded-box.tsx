import React from 'react'
import { Box, Text } from 'ink'
import { theme as colors } from './theme/index.js'

interface HalfLinePaddedBoxProps {
  backgroundColor?: string
  children: React.ReactNode
  width: number
}

/**
 * Renders children inside a terminal-width colored box with half-line
 * padding on top and bottom using ▀ and ▄ block characters.
 * Since Ink Box doesn't support backgroundColor, we use Text wrappers.
 */
export function HalfLinePaddedBox({ backgroundColor, children, width }: HalfLinePaddedBoxProps) {
  const bg = backgroundColor ?? colors.background.message
  const termBg = colors.background.primary

  return (
    <Box width={width} flexDirection="column">
      <Text backgroundColor={bg} color={termBg}>{'▀'.repeat(width)}</Text>
      <Box paddingX={1} flexDirection="column">
        {children}
      </Box>
      <Text color={termBg} backgroundColor={bg}>{'▄'.repeat(width)}</Text>
    </Box>
  )
}
