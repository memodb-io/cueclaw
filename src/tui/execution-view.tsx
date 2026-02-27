import { useCallback } from 'react'
import { Box, Text } from 'ink'
import type { Workflow, StepStatus } from '../types.js'
import { useKeypress, KeyPriority } from './use-keypress.js'
import { theme as colors } from './theme/index.js'
import { keyBindings } from './key-bindings.js'
import { useUIState } from './ui-state-context.js'

interface StepProgress {
  stepId: string
  status: StepStatus
  duration?: number
}

interface ExecutionViewProps {
  workflow: Workflow
  stepProgress: Map<string, StepProgress>
  output: string[]
  onBack?: () => void
  onAbort?: () => void
}

export function ExecutionView({ workflow, stepProgress, output, onBack, onAbort }: ExecutionViewProps) {
  const { isExecuting } = useUIState()
  // Local isRunning for display only (shows "Running" while any step has running status)
  const isRunning = Array.from(stepProgress.values()).some(s => s.status === 'running')

  useKeypress('execution-view-actions', KeyPriority.Normal, useCallback((input, key) => {
    if (isExecuting && onAbort && keyBindings.abortExec(input, key)) {
      onAbort()
      return true
    }
    if (!isExecuting && onBack && (keyBindings.submit(input, key) || keyBindings.quit(input, key) || keyBindings.escape(input, key))) {
      onBack()
      return true
    }
    return false
  }, [isExecuting, onAbort, onBack]))

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      {/* Content area — grows to push actions to bottom */}
      <Box flexDirection="column" flexGrow={1}>
        <Box justifyContent="space-between">
          <Text color={colors.border.accent} bold>Workflow: {workflow.name}</Text>
          <Text color={colors.ui.comment}>Status: {isRunning ? 'Running' : 'Complete'}</Text>
        </Box>
        <Text>{''}</Text>

        <Text bold color={colors.text.primary}>Steps:</Text>
        {workflow.steps.map((step, i) => {
          const progress = stepProgress.get(step.id)
          const status = progress?.status ?? 'pending'
          const icon = statusIcon(status)
          const durationText = progress?.duration ? ` (${formatDuration(progress.duration)})` : ''

          return (
            <Box key={step.id}>
              <Text color={statusColor(status)}>
                {icon} {i + 1}. {step.description}{durationText}
              </Text>
            </Box>
          )
        })}

        {output.length > 0 && (
          <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={colors.border.default} paddingX={1}>
            <Text color={colors.ui.comment}>Live Output</Text>
            {output.slice(-10).map((line, i) => (
              <Text key={i} color={colors.text.secondary}>{line}</Text>
            ))}
          </Box>
        )}
      </Box>

      {/* Actions — pinned to bottom */}
      <Box marginTop={1}>
        <Text color={colors.ui.comment}>
          {isExecuting ? 'Press [X] to cancel' : 'Press Enter, Q, or Esc to return to chat'}
        </Text>
      </Box>
    </Box>
  )
}

function statusIcon(status: StepStatus): string {
  switch (status) {
    case 'succeeded': return '✓'
    case 'running': return '⊷'
    case 'failed': return '✗'
    case 'skipped': return '○'
    default: return '○'
  }
}

function statusColor(status: StepStatus): string {
  switch (status) {
    case 'succeeded': return colors.status.success
    case 'running': return colors.status.warning
    case 'failed': return colors.status.error
    case 'skipped': return colors.status.muted
    default: return colors.status.muted
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${Math.round(ms / 1000)}s`
}

export type { StepProgress }
