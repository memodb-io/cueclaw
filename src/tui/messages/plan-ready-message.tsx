import { memo } from 'react'
import { Box, Text } from 'ink'
import { theme as colors } from '../theme/index.js'

export const PlanReadyMessage = memo(function PlanReadyMessage({ workflowName }: { workflowName: string }) {
  return (
    <Box paddingX={1}>
      <Box width={2}>
        <Text color={colors.status.success}>{'✓ '}</Text>
      </Box>
      <Box flexShrink={1}>
        <Text color={colors.status.success}>Plan ready: "{workflowName}"</Text>
      </Box>
    </Box>
  )
})
