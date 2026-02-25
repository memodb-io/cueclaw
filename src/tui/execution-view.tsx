import { Box, Text } from 'ink'
import { Spinner, useComponentTheme, type ComponentTheme } from '@inkjs/ui'
import type { Workflow, StepStatus } from '../types.js'

interface StepProgress {
  stepId: string
  status: StepStatus
  duration?: number
}

interface ExecutionViewProps {
  workflow: Workflow
  stepProgress: Map<string, StepProgress>
  output: string[]
}

export function ExecutionView({ workflow, stepProgress, output }: ExecutionViewProps) {
  const { styles } = useComponentTheme<ComponentTheme>('PlanView')
  const titleStyle = styles?.title?.() ?? { color: 'cyan', bold: true }

  const isRunning = Array.from(stepProgress.values()).some(s => s.status === 'running')

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text {...titleStyle}>Workflow: {workflow.name}</Text>
        <Text dimColor>Status: {isRunning ? 'Running' : 'Complete'}</Text>
      </Box>
      <Text>{''}</Text>

      <Text bold>Steps:</Text>
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
            {status === 'running' && <Spinner />}
          </Box>
        )
      })}

      {output.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>── Live Output ──</Text>
          {output.slice(-10).map((line, i) => (
            <Text key={i} dimColor>{line}</Text>
          ))}
        </Box>
      )}
    </Box>
  )
}

function statusIcon(status: StepStatus): string {
  switch (status) {
    case 'succeeded': return '✓'
    case 'running': return '●'
    case 'failed': return '✗'
    case 'skipped': return '○'
    default: return ' '
  }
}

function statusColor(status: StepStatus): string {
  switch (status) {
    case 'succeeded': return 'green'
    case 'running': return 'yellow'
    case 'failed': return 'red'
    case 'skipped': return 'gray'
    default: return 'gray'
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${Math.round(ms / 1000)}s`
}

export type { StepProgress }
