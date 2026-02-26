import { Box, Text } from 'ink'
import type { Workflow, WorkflowPhase, StepRun } from '../types.js'

// ─── Phase Color ───

function phaseColor(phase: WorkflowPhase): string {
  switch (phase) {
    case 'executing': return 'yellow'
    case 'active': return 'green'
    case 'completed': return 'green'
    case 'failed': return 'red'
    case 'paused': return 'gray'
    default: return 'white'
  }
}

// ─── Workflow Table ───

interface WorkflowTableProps {
  workflows: Workflow[]
}

export function WorkflowTable({ workflows }: WorkflowTableProps) {
  if (workflows.length === 0) {
    return <Text dimColor>No workflows found.</Text>
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Box width={14}><Text bold dimColor>ID</Text></Box>
        <Box width={28}><Text bold dimColor>Name</Text></Box>
        <Box width={14}><Text bold dimColor>Phase</Text></Box>
        <Box width={16}><Text bold dimColor>Trigger</Text></Box>
      </Box>
      {workflows.map((wf) => {
        const trigger = wf.trigger.type === 'poll'
          ? `poll (${wf.trigger.interval_seconds}s)`
          : wf.trigger.type === 'cron'
            ? `cron`
            : 'manual'
        return (
          <Box key={wf.id}>
            <Box width={14}><Text>{wf.id.slice(0, 12)}</Text></Box>
            <Box width={28}><Text>{wf.name.slice(0, 26)}</Text></Box>
            <Box width={14}><Text color={phaseColor(wf.phase)}>{wf.phase}</Text></Box>
            <Box width={16}><Text dimColor>{trigger}</Text></Box>
          </Box>
        )
      })}
      <Text dimColor>
        {'\n'}Use /status {'<id>'} to view details, /pause /resume /delete to manage.
      </Text>
    </Box>
  )
}

// ─── Workflow Detail ───

interface WorkflowDetailProps {
  workflow: Workflow
  latestRun?: { status: string; started_at: string; error?: string }
  stepRuns?: StepRun[]
}

export function WorkflowDetail({ workflow, latestRun, stepRuns }: WorkflowDetailProps) {
  const trigger = workflow.trigger.type === 'poll'
    ? `poll (${workflow.trigger.interval_seconds}s)`
    : workflow.trigger.type === 'cron'
      ? `cron (${workflow.trigger.expression})`
      : 'manual'

  return (
    <Box flexDirection="column">
      <Text bold>{workflow.name}</Text>
      <Text dimColor>ID: {workflow.id}</Text>
      <Text>Phase: <Text color={phaseColor(workflow.phase)}>{workflow.phase}</Text></Text>
      <Text dimColor>Trigger: {trigger}</Text>
      <Text dimColor>Created: {workflow.created_at}</Text>
      <Text>{''}</Text>
      <Text bold>Steps:</Text>
      {workflow.steps.map((step, i) => {
        const deps = step.depends_on.length > 0 ? ` (after: ${step.depends_on.join(', ')})` : ''
        return (
          <Text key={step.id} dimColor>  {i + 1}. {step.id}: {step.description.slice(0, 60)}{deps}</Text>
        )
      })}
      {latestRun && (
        <>
          <Text>{''}</Text>
          <Text bold>Latest Run:</Text>
          <Text dimColor>  Status: {latestRun.status}</Text>
          {latestRun.error && <Text color="red">  Error: {latestRun.error}</Text>}
          {stepRuns && stepRuns.length > 0 && (
            <>
              <Text dimColor>  Step results:</Text>
              {stepRuns.map(sr => (
                <Text key={sr.id} dimColor>    {sr.step_id}: {sr.status}{sr.output_json ? ` — ${sr.output_json.slice(0, 50)}` : ''}</Text>
              ))}
            </>
          )}
        </>
      )}
    </Box>
  )
}
