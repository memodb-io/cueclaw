import { useCallback, memo } from 'react'
import { Box, Text } from 'ink'
import type { Workflow, PlanStep } from '../types.js'
import { useKeypress, KeyPriority } from './use-keypress.js'
import { theme as colors } from './theme/index.js'
import { keyBindings } from './key-bindings.js'

interface PlanViewProps {
  workflow: Workflow
  onConfirm: () => void
  onModify: () => void
  onCancel: () => void
}

export function PlanView({ workflow, onConfirm, onModify, onCancel }: PlanViewProps) {
  useKeypress('plan-view-actions', KeyPriority.Normal, useCallback((input, key) => {
    if (keyBindings.confirmPlan(input, key)) { onConfirm(); return true }
    if (keyBindings.modifyPlan(input, key)) { onModify(); return true }
    if (keyBindings.cancelPlan(input, key)) { onCancel(); return true }
    return false
  }, [onConfirm, onModify, onCancel]))

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
      <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={colors.border.focused}>
        <Text color={colors.border.accent} bold>Plan: {workflow.name}</Text>
        <Text color={colors.ui.comment}>Trigger: {triggerLabel}</Text>
        <Text>{''}</Text>

        {workflow.steps.map((step, i) => (
          <StepLine key={step.id} step={step} index={i + 1} />
        ))}

        <Text>{''}</Text>
        <Text color={colors.ui.comment}>Failure policy: {failureDesc}</Text>
      </Box>

      {/* Actions — pinned to bottom */}
      <Box marginTop={1}>
        <Text>
          <Text color={colors.status.success}>[Y] Confirm</Text>
          {'  '}
          <Text color={colors.status.warning}>[M] Modify</Text>
          {'  '}
          <Text color={colors.status.error}>[N] Cancel</Text>
        </Text>
      </Box>
    </Box>
  )
}

function stepStatusSymbol(index: number): string {
  return `○ ${index}.`
}

const StepLine = memo(function StepLine({ step, index }: { step: PlanStep; index: number }) {
  return (
    <Box flexDirection="column">
      <Text color={colors.status.muted}>{stepStatusSymbol(index)} {step.description}</Text>
      {step.depends_on && step.depends_on.length > 0 && (
        <Text color={colors.ui.comment}>   └─ depends on: {step.depends_on.join(', ')}</Text>
      )}
    </Box>
  )
})
