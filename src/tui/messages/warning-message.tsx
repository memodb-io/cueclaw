import { memo } from 'react'
import { Box, Text } from 'ink'
import { theme as colors } from '../theme/index.js'

export const WarningMessage = memo(function WarningMessage({ text }: { text: string }) {
  return (
    <Box paddingX={1}>
      <Box width={2}>
        <Text color={colors.status.warning}>{'⚠ '}</Text>
      </Box>
      <Box flexShrink={1}>
        <Text color={colors.status.warning}>{text}</Text>
      </Box>
    </Box>
  )
})
