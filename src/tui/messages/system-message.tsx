import { memo } from 'react'
import { Box, Text } from 'ink'
import { theme as colors } from '../theme/index.js'

export const SystemMessage = memo(function SystemMessage({ text }: { text: string }) {
  return (
    <Box paddingX={1} paddingLeft={3}>
      <Text color={colors.ui.comment} italic>{text}</Text>
    </Box>
  )
})
