import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { Workflow, WorkflowPhase } from '../types.js'

interface StatusProps {
  workflows: Workflow[]
  onSelect: (workflow: Workflow) => void
  onBack: () => void
  onStop?: (workflow: Workflow) => void
  onDelete?: (workflow: Workflow) => void
}

type ConfirmAction = { type: 'stop' | 'delete'; workflowId: string }

export function Status({ workflows, onSelect, onBack, onStop, onDelete }: StatusProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useInput((input, key) => {
    // Handle confirmation prompt
    if (confirm) {
      if (input.toLowerCase() === 'y') {
        const wf = workflows.find(w => w.id === confirm.workflowId)
        if (wf) {
          if (confirm.type === 'stop' && onStop) {
            onStop(wf)
            setMessage(`Stopped "${wf.name}"`)
          } else if (confirm.type === 'delete' && onDelete) {
            onDelete(wf)
            setMessage(`Deleted "${wf.name}"`)
          }
        }
        setConfirm(null)
      } else if (input.toLowerCase() === 'n' || key.escape) {
        setConfirm(null)
      }
      return
    }

    // Clear message on any key
    if (message) setMessage(null)

    if (key.upArrow && selectedIndex > 0) setSelectedIndex(selectedIndex - 1)
    if (key.downArrow && selectedIndex < workflows.length - 1) setSelectedIndex(selectedIndex + 1)
    if (key.return && workflows.length > 0) onSelect(workflows[selectedIndex]!)

    const selected = workflows[selectedIndex]
    if (input === 's' && onStop && selected && (selected.phase === 'executing' || selected.phase === 'active')) {
      setConfirm({ type: 'stop', workflowId: selected.id })
    }
    if (input === 'x' && onDelete && selected) {
      setConfirm({ type: 'delete', workflowId: selected.id })
    }
    if (key.escape || input === 'q') onBack()
  })

  const phaseColor = (phase: WorkflowPhase): string => {
    switch (phase) {
      case 'executing': return 'yellow'
      case 'active': return 'green'
      case 'completed': return 'green'
      case 'failed': return 'red'
      case 'paused': return 'gray'
      default: return 'white'
    }
  }

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      {/* Content — grows to push actions to bottom */}
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color="cyan">Workflows</Text>
        <Text>{''}</Text>

        {workflows.length === 0 ? (
          <Text dimColor>No workflows found. Type a description to create one.</Text>
        ) : (
          <>
            <Box>
              <Box width={14}><Text bold>ID</Text></Box>
              <Box width={28}><Text bold>Name</Text></Box>
              <Box width={14}><Text bold>Phase</Text></Box>
            </Box>
            {workflows.map((wf, i) => (
              <Box key={wf.id}>
                <Text inverse={i === selectedIndex}>
                  <Text>{wf.id.slice(0, 12).padEnd(14)}</Text>
                  <Text>{wf.name.slice(0, 26).padEnd(28)}</Text>
                  <Text color={phaseColor(wf.phase)}>{wf.phase}</Text>
                </Text>
              </Box>
            ))}
          </>
        )}
      </Box>

      {/* Actions — pinned to bottom */}
      <Box marginTop={1}>
        {message ? (
          <Text bold color="red">{message}</Text>
        ) : confirm ? (
          <Text bold color="yellow">{confirm.type === 'stop' ? 'Stop' : 'Delete'} workflow {confirm.workflowId.slice(0, 12)}? [Y]es / [N]o</Text>
        ) : (
          <Text dimColor>[Enter] View  [S] Stop  [X] Delete  [Q] Back</Text>
        )}
      </Box>
    </Box>
  )
}
