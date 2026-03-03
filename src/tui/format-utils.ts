import type { StepStatus, WorkflowPhase, WorkflowRun } from '../types.js'
import { theme as colors } from './theme/index.js'

export function stepStatusIcon(status: StepStatus | string): string {
  switch (status) {
    case 'succeeded': return '✓'
    case 'running': return '⊷'
    case 'failed': return '✗'
    case 'skipped': return '○'
    default: return '○'
  }
}

export function stepStatusColor(status: StepStatus | string): string {
  switch (status) {
    case 'succeeded': return colors.status.success
    case 'running': return colors.status.warning
    case 'failed': return colors.status.error
    case 'skipped': return colors.status.muted
    default: return colors.status.muted
  }
}

export function phaseColor(phase: WorkflowPhase): string {
  switch (phase) {
    case 'executing': return colors.status.warning
    case 'active': return colors.status.success
    case 'completed': return colors.status.success
    case 'failed': return colors.status.error
    case 'paused': return colors.status.muted
    default: return colors.text.primary
  }
}

export function runStatusColor(status: WorkflowRun['status']): string {
  switch (status) {
    case 'completed': return colors.status.success
    case 'running': return colors.status.warning
    case 'failed': return colors.status.error
    default: return colors.text.primary
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60000)}m`
}

export function formatTrigger(trigger: { type: string; interval_seconds?: number; diff_mode?: string; expression?: string; timezone?: string }): string {
  switch (trigger.type) {
    case 'poll': return `poll every ${trigger.interval_seconds}s (${trigger.diff_mode})`
    case 'cron': return `cron: ${trigger.expression}${trigger.timezone ? ` (${trigger.timezone})` : ''}`
    case 'manual': return 'manual'
    default: return trigger.type
  }
}
