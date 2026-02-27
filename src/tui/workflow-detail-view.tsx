import { useState, useCallback } from 'react'
import { Box, Text } from 'ink'
import type { Workflow, WorkflowRun, StepRun, WorkflowPhase } from '../types.js'
import { useKeypress, KeyPriority } from './use-keypress.js'
import { theme as colors } from './theme/index.js'
import { keyBindings } from './key-bindings.js'

interface WorkflowDetailViewProps {
  workflow: Workflow
  runs: WorkflowRun[]
  latestStepRuns: StepRun[]
  onBack: () => void
  onSelectRun: (runId: string) => void
  onStop?: () => void
}

export function WorkflowDetailView({ workflow, runs, latestStepRuns, onBack, onSelectRun, onStop }: WorkflowDetailViewProps) {
  const [selectedRunIndex, setSelectedRunIndex] = useState(0)
  const displayRuns = runs.slice(0, 5)

  useKeypress('detail-view-actions', KeyPriority.Normal, useCallback((input, key) => {
    if (keyBindings.escape(input, key) || keyBindings.quit(input, key)) {
      onBack()
      return true
    }
    if (keyBindings.submit(input, key) && displayRuns.length > 0) {
      onSelectRun(displayRuns[selectedRunIndex]!.id)
      return true
    }
    if (keyBindings.stopWorkflow(input, key) && onStop) {
      onStop()
      return true
    }
    if (keyBindings.upArrow(input, key) && selectedRunIndex > 0) {
      setSelectedRunIndex(selectedRunIndex - 1)
      return true
    }
    if (keyBindings.downArrow(input, key) && selectedRunIndex < displayRuns.length - 1) {
      setSelectedRunIndex(selectedRunIndex + 1)
      return true
    }
    return false
  }, [onBack, onSelectRun, onStop, displayRuns, selectedRunIndex]))

  const canStop = workflow.phase === 'executing' || workflow.phase === 'active'

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Box flexDirection="column" flexGrow={1}>
        {/* Header */}
        <Box justifyContent="space-between">
          <Text color={colors.border.accent} bold>{workflow.name}</Text>
          <Text color={phaseColor(workflow.phase)}>{workflow.phase}</Text>
        </Box>
        <Text>{''}</Text>

        {/* Info section */}
        <Text color={colors.ui.comment}>ID: {workflow.id}</Text>
        {workflow.description && <Text color={colors.text.secondary}>{workflow.description}</Text>}
        <Text color={colors.ui.comment}>Trigger: {formatTrigger(workflow.trigger)}</Text>
        <Text color={colors.ui.comment}>Failure policy: {workflow.failure_policy.on_step_failure} (retries: {workflow.failure_policy.max_retries})</Text>
        <Text color={colors.ui.comment}>Created: {workflow.created_at}  Updated: {workflow.updated_at}</Text>
        <Text>{''}</Text>

        {/* Steps */}
        <Text bold color={colors.text.primary}>Steps ({workflow.steps.length}):</Text>
        {workflow.steps.map((step, i) => {
          const deps = step.depends_on.length > 0 ? ` → depends on: ${step.depends_on.join(', ')}` : ''
          const stepRun = latestStepRuns.find(sr => sr.step_id === step.id)
          const icon = stepRun ? statusIcon(stepRun.status) : '○'
          const iconColor = stepRun ? statusColor(stepRun.status) : colors.status.muted
          return (
            <Box key={step.id}>
              <Text color={iconColor}>{icon} </Text>
              <Text color={colors.text.secondary}>{i + 1}. {step.description}</Text>
              {deps && <Text color={colors.ui.comment}>{deps}</Text>}
            </Box>
          )
        })}
        <Text>{''}</Text>

        {/* Recent Runs */}
        <Text bold color={colors.text.primary}>Recent Runs:</Text>
        {displayRuns.length === 0 ? (
          <Text dimColor>No runs yet.</Text>
        ) : (
          <>
            <Box>
              <Box width={14}><Text bold>Status</Text></Box>
              <Box width={24}><Text bold>Started</Text></Box>
              <Box width={12}><Text bold>Duration</Text></Box>
              <Box><Text bold>Error</Text></Box>
            </Box>
            {displayRuns.map((run, i) => (
              <Box key={run.id}>
                <Text inverse={i === selectedRunIndex}>
                  <Text color={runStatusColor(run.status)}>{run.status.padEnd(14)}</Text>
                  <Text>{run.started_at.slice(0, 22).padEnd(24)}</Text>
                  <Text>{(run.duration_ms != null ? formatDuration(run.duration_ms) : '—').padEnd(12)}</Text>
                  <Text color={colors.status.error}>{run.error ? run.error.slice(0, 40) : ''}</Text>
                </Text>
              </Box>
            ))}
          </>
        )}
      </Box>

      {/* Actions */}
      <Box marginTop={1}>
        <Text dimColor>
          {displayRuns.length > 0 ? '[Enter] View run  ' : ''}
          {canStop ? '[S] Stop  ' : ''}
          [Q/Esc] Back
        </Text>
      </Box>
    </Box>
  )
}

function phaseColor(phase: WorkflowPhase): string {
  switch (phase) {
    case 'executing': return colors.status.warning
    case 'active': return colors.status.success
    case 'completed': return colors.status.success
    case 'failed': return colors.status.error
    case 'paused': return colors.status.muted
    default: return colors.text.primary
  }
}

function runStatusColor(status: WorkflowRun['status']): string {
  switch (status) {
    case 'completed': return colors.status.success
    case 'running': return colors.status.warning
    case 'failed': return colors.status.error
    default: return colors.text.primary
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case 'succeeded': return '✓'
    case 'running': return '⊷'
    case 'failed': return '✗'
    case 'skipped': return '○'
    default: return '○'
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'succeeded': return colors.status.success
    case 'running': return colors.status.warning
    case 'failed': return colors.status.error
    case 'skipped': return colors.status.muted
    default: return colors.status.muted
  }
}

function formatTrigger(trigger: Workflow['trigger']): string {
  switch (trigger.type) {
    case 'poll': return `poll every ${trigger.interval_seconds}s (${trigger.diff_mode})`
    case 'cron': return `cron: ${trigger.expression}${trigger.timezone ? ` (${trigger.timezone})` : ''}`
    case 'manual': return 'manual'
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60000)}m`
}
