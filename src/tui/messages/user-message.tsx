import { memo } from 'react'
import { Box, Text, useStdout } from 'ink'
import { theme as colors } from '../theme/index.js'
import { HalfLinePaddedBox } from '../half-line-padded-box.js'

export const UserMessage = memo(function UserMessage({ text }: { text: string }) {
  const { stdout } = useStdout()
  const cols = stdout?.columns ?? 80

  return (
    <HalfLinePaddedBox width={cols} backgroundColor={colors.background.message}>
      <Box>
        <Box width={2}>
          <Text color={colors.text.accent}>{'> '}</Text>
        </Box>
        <Box flexShrink={1}>
          <Text color={colors.text.secondary}>{text}</Text>
        </Box>
      </Box>
    </HalfLinePaddedBox>
  )
})
