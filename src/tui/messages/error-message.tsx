import { memo } from 'react'
import { Box, Text } from 'ink'
import { theme as colors } from '../theme/index.js'

export const ErrorMessage = memo(function ErrorMessage({ text }: { text: string }) {
  return (
    <Box paddingX={1}>
      <Box width={2}>
        <Text color={colors.status.error}>{'✗ '}</Text>
      </Box>
      <Box flexShrink={1}>
        <Text color={colors.status.error}>{text}</Text>
      </Box>
    </Box>
  )
})
