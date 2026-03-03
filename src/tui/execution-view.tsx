import { useCallback } from 'react'
import { Box, Text } from 'ink'
import type { Workflow, StepStatus } from '../types.js'
import { useKeypress, KeyPriority } from './use-keypress.js'
import { theme as colors } from './theme/index.js'
import { keyBindings } from './key-bindings.js'
import { useUIState } from './ui-state-context.js'
import { stepStatusIcon, stepStatusColor, formatDuration } from './format-utils.js'

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
          const icon = stepStatusIcon(status)
          const durationText = progress?.duration ? ` (${formatDuration(progress.duration)})` : ''

          return (
            <Box key={step.id}>
              <Text color={stepStatusColor(status)}>
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

      <Box marginTop={1}>
        <Text color={colors.ui.comment}>
          {isExecuting ? 'Press [X] to cancel' : 'Press Enter, Q, or Esc to return to chat'}
        </Text>
      </Box>
    </Box>
  )
}

export type { StepProgress }
