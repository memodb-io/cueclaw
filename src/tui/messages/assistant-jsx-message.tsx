import { memo } from 'react'
import { Box, Text } from 'ink'
import { theme as colors } from '../theme/index.js'

export const AssistantJsxMessage = memo(function AssistantJsxMessage({ content }: { content: React.ReactNode }) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Box width={2}>
          <Text color={colors.text.accent}>{'✦ '}</Text>
        </Box>
      </Box>
      {content}
    </Box>
  )
})
