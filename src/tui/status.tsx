import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { Workflow, WorkflowPhase } from '../types.js'

interface StatusProps {
  workflows: Workflow[]
  onSelect: (workflow: Workflow) => void
  onBack: () => void
}

export function Status({ workflows, onSelect, onBack }: StatusProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useInput((input, key) => {
    if (key.upArrow && selectedIndex > 0) setSelectedIndex(selectedIndex - 1)
    if (key.downArrow && selectedIndex < workflows.length - 1) setSelectedIndex(selectedIndex + 1)
    if (key.return && workflows.length > 0) onSelect(workflows[selectedIndex]!)
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
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor="gray">
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

      <Text>{''}</Text>
      <Text dimColor>[Enter] View  [Q] Back</Text>
    </Box>
  )
}
