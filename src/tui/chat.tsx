import { Box } from 'ink'
import { MainContent } from './main-content.js'
import { Composer } from './composer.js'

// Re-export ChatMessage from the canonical location for backward compatibility
export type { ChatMessage } from './ui-state-context.js'

export function Chat() {
  return (
    <Box flexDirection="column" flexGrow={1}>
      <MainContent />
      <Composer />
    </Box>
  )
}
