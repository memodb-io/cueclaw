import { Box, Text, useInput } from 'ink'
import { useComponentTheme, type ComponentTheme } from '@inkjs/ui'
import type { Workflow, PlanStep } from '../types.js'

interface PlanViewProps {
  workflow: Workflow
  onConfirm: () => void
  onModify: () => void
  onCancel: () => void
}

export function PlanView({ workflow, onConfirm, onModify, onCancel }: PlanViewProps) {
  const { styles } = useComponentTheme<ComponentTheme>('PlanView')
  const titleStyle = styles?.title?.() ?? { color: 'cyan', bold: true }
  const pendingStyle = styles?.stepPending?.() ?? { color: 'gray' }
  const borderStyle = styles?.border?.() ?? { borderColor: 'gray' }

  useInput((input) => {
    if (input === 'y' || input === 'Y') onConfirm()
    if (input === 'm' || input === 'M') onModify()
    if (input === 'n' || input === 'N') onCancel()
  })

  const trigger = workflow.trigger
  const triggerLabel = trigger.type === 'manual'
    ? 'manual'
    : trigger.type === 'cron'
      ? `cron (${trigger.expression})`
      : `poll (${trigger.interval_seconds}s)`

  const failureDesc = workflow.failure_policy.on_step_failure

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      {/* Content — grows to push actions to bottom */}
      <Box flexDirection="column" flexGrow={1} borderStyle="round" {...borderStyle}>
        <Text {...titleStyle}>Plan: {workflow.name}</Text>
        <Text dimColor>Trigger: {triggerLabel}</Text>
        <Text>{''}</Text>

        {workflow.steps.map((step, i) => (
          <StepLine key={step.id} step={step} index={i + 1} style={pendingStyle} />
        ))}

        <Text>{''}</Text>
        <Text dimColor>Failure policy: {failureDesc}</Text>
      </Box>

      {/* Actions — pinned to bottom */}
      <Box marginTop={1}>
        <Text>
          <Text color="green">[Y] Confirm</Text>
          {'  '}
          <Text color="yellow">[M] Modify</Text>
          {'  '}
          <Text color="red">[N] Cancel</Text>
        </Text>
      </Box>
    </Box>
  )
}

function StepLine({ step, index, style }: { step: PlanStep; index: number; style: Record<string, unknown> }) {
  return (
    <Box flexDirection="column">
      <Text {...style}>{index}. {step.description}</Text>
      {step.depends_on && step.depends_on.length > 0 && (
        <Text dimColor>   └─ depends on: {step.depends_on.join(', ')}</Text>
      )}
    </Box>
  )
}
