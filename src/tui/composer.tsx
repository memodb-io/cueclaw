import { useState, useMemo } from 'react'
import { Box, Text, useStdout } from 'ink'
import { theme as colors } from './theme/index.js'
import { useUIState } from './ui-state-context.js'
import { useUIActions } from './ui-actions-context.js'
import { ResettableInput } from './resettable-input.js'
import { useInputHistory } from './use-input-history.js'
import { getCommands } from './commands/index.js'

function modeLabel(state: { isExecuting: boolean; isGenerating: boolean; isConversing: boolean }): { text: string; color: string } {
  if (state.isExecuting) return { text: 'executing', color: colors.status.warning }
  if (state.isGenerating) return { text: 'generating', color: colors.text.accent }
  if (state.isConversing) return { text: 'conversing', color: colors.text.accent }
  return { text: 'idle', color: colors.text.secondary }
}

function daemonLabel(status: string): string {
  switch (status) {
    case 'running': return 'daemon'
    case 'external': return 'external'
    case 'starting': return 'starting...'
    default: return ''
  }
}

export function Composer() {
  const { isGenerating, isExecuting, isConversing, daemonStatus, footerExtra, footerHints } = useUIState()
  const { handleChatSubmit } = useUIActions()
  const { stdout } = useStdout()
  const cols = stdout?.columns ?? 80

  // Input history
  const history = useInputHistory()

  // Track current input for command hints
  const [currentInput, setCurrentInput] = useState('')

  const allCommands = useMemo(() => getCommands(), [])

  // Compute matching commands for the dropdown hint
  const matchingCommands = useMemo(() => {
    if (!currentInput.startsWith('/')) return []
    const prefix = currentInput.toLowerCase()
    return allCommands.filter(c => {
      const full = `/${c.name}`
      return full.startsWith(prefix) || c.aliases.some(a => `/${a}`.startsWith(prefix))
    })
  }, [currentInput, allCommands])

  const showCommandHints = currentInput.startsWith('/') && matchingCommands.length > 0 && currentInput !== '/' + matchingCommands[0]?.name

  const mode = modeLabel({ isExecuting, isGenerating, isConversing })
  const daemon = daemonLabel(daemonStatus)

  return (
    <>
      {/* Top separator line */}
      <Box paddingX={1}>
        <Text color={colors.border.default}>{'\u2500'.repeat(Math.max(0, cols - 2))}</Text>
      </Box>

      {/* Status bar: [mode]  ~/project    daemon */}
      {!isGenerating && (
        <Box paddingX={1} justifyContent="space-between">
          <Box gap={2}>
            <Text color={mode.color}>[{mode.text}]</Text>
            {footerHints && <Text color={colors.ui.comment}>{footerHints}</Text>}
          </Box>
          <Box gap={2}>
            {daemon && <Text color={colors.ui.comment}>{daemon}</Text>}
            {footerExtra && <Text color={colors.ui.comment}>{footerExtra}</Text>}
          </Box>
        </Box>
      )}

      {/* Command hints — shown above input when typing / */}
      {!isGenerating && showCommandHints && (
        <Box flexDirection="column" paddingX={2}>
          {matchingCommands.slice(0, 6).map((cmd) => (
            <Box key={cmd.name} gap={1}>
              <Text color={colors.status.info}>/{cmd.name}</Text>
              <Text color={colors.ui.comment}>{'\u2014'} {cmd.description}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Input area with rounded border */}
      {!isGenerating && (
        <Box paddingX={1}>
          <Box
            borderStyle="round"
            borderColor={colors.border.focused}
            paddingX={1}
            width={cols - 2}
          >
            <Text color={colors.prompt}>{'> '}</Text>
            <ResettableInput
              placeholder="Describe a workflow or type /help"
              onChange={(value) => {
                setCurrentInput(value)
                history.resetBrowsing()
              }}
              onSubmit={(value) => {
                const trimmed = value.trim()
                if (trimmed) {
                  history.push(trimmed)
                  setCurrentInput('')
                  handleChatSubmit(trimmed)
                }
              }}
              onUpArrow={history.up}
              onDownArrow={history.down}
              isDisabled={isGenerating}
            />
          </Box>
        </Box>
      )}
    </>
  )
}
