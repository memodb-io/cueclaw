import { useState, useCallback, useEffect } from 'react'
import { Box, Text } from 'ink'
import type { Workflow, WorkflowPhase } from '../types.js'
import { useKeypress, KeyPriority } from './use-keypress.js'
import { theme as colors } from './theme/index.js'
import { keyBindings } from './key-bindings.js'

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

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(null), 3000)
    return () => clearTimeout(timer)
  }, [message])

  useKeypress('status-view', KeyPriority.Normal, useCallback((input, key) => {
    // Handle confirmation prompt
    if (confirm) {
      if (keyBindings.confirmYes(input, key)) {
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
        return true
      } else if (keyBindings.confirmNo(input, key)) {
        setConfirm(null)
        return true
      }
      return true
    }

    // Clear message on any key
    if (message) setMessage(null)

    if (keyBindings.upArrow(input, key) && selectedIndex > 0) { setSelectedIndex(selectedIndex - 1); return true }
    if (keyBindings.downArrow(input, key) && selectedIndex < workflows.length - 1) { setSelectedIndex(selectedIndex + 1); return true }
    if (keyBindings.submit(input, key) && workflows.length > 0) { onSelect(workflows[selectedIndex]!); return true }

    const selected = workflows[selectedIndex]
    if (keyBindings.stopWorkflow(input, key) && onStop && selected && (selected.phase === 'executing' || selected.phase === 'active')) {
      setConfirm({ type: 'stop', workflowId: selected.id })
      return true
    }
    if (keyBindings.deleteWorkflow(input, key) && onDelete && selected) {
      setConfirm({ type: 'delete', workflowId: selected.id })
      return true
    }
    if (keyBindings.escape(input, key) || keyBindings.quit(input, key)) { onBack(); return true }
    return false
  }, [confirm, message, selectedIndex, workflows, onSelect, onBack, onStop, onDelete]))

  const phaseColor = (phase: WorkflowPhase): string => {
    switch (phase) {
      case 'executing': return colors.status.warning
      case 'active': return colors.status.success
      case 'completed': return colors.status.success
      case 'failed': return colors.status.error
      case 'paused': return colors.status.muted
      default: return colors.text.primary
    }
  }

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      {/* Content — grows to push actions to bottom */}
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color={colors.border.accent}>Workflows</Text>
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
      <Box flexDirection="column" marginTop={1}>
        {message && <Text bold color={colors.status.success}>{message}</Text>}
        {confirm ? (
          <Text bold color={colors.status.warning}>{confirm.type === 'stop' ? 'Stop' : 'Delete'} workflow {confirm.workflowId.slice(0, 12)}? [Y]es / [N]o</Text>
        ) : (
          <Text dimColor>[Enter] View  [S] Stop  [X] Delete  [Q] Back</Text>
        )}
      </Box>
    </Box>
  )
}
