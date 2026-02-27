import { memo } from 'react'
import { Box, Text } from 'ink'
import { theme as colors } from '../theme/index.js'

export const AssistantMessage = memo(function AssistantMessage({ text }: { text: string }) {
  return (
    <Box paddingX={1}>
      <Box width={2}>
        <Text color={colors.text.accent}>{'✦ '}</Text>
      </Box>
      <Box flexShrink={1}>
        <Text color={colors.text.primary}>{text}</Text>
      </Box>
    </Box>
  )
})
