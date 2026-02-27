import React, { createContext, useContext, useState, useCallback } from 'react'
import { Box, Text } from 'ink'
import { useKeypress, KeyPriority } from './use-keypress.js'
import { theme as colors } from './theme/index.js'

// ─── Types ───

export const DialogPriority = {
  Normal: 0,
  High: 100,
  Critical: 200,
} as const

export type DialogPriorityLevel = (typeof DialogPriority)[keyof typeof DialogPriority]

interface DialogAction {
  key: string
  label: string
  handler: () => void
}

interface Dialog {
  title: string
  message: string
  actions: DialogAction[]
  priority?: DialogPriorityLevel
}

interface DialogContextValue {
  showDialog: (dialog: Dialog) => void
  dismissDialog: () => void
}

const DialogContext = createContext<DialogContextValue | null>(null)

// ─── Hook ───

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialog must be used within DialogManager')
  return ctx
}

// ─── DialogOverlay ───

function DialogOverlay({ dialog, onDismiss }: { dialog: Dialog; onDismiss: () => void }) {
  // Consume ALL keypresses at Critical priority
  useKeypress('dialog-overlay', KeyPriority.Critical, useCallback((input, key) => {
    // Check action keys
    for (const action of dialog.actions) {
      if (input.toLowerCase() === action.key.toLowerCase()) {
        action.handler()
        return true
      }
    }
    // Esc dismisses
    if (key.escape) {
      onDismiss()
      return true
    }
    // Consume everything else to block lower-priority handlers
    return true
  }, [dialog.actions, onDismiss]))

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.border.focused} paddingX={2} paddingY={1}>
      <Text bold color={colors.status.warning}>{dialog.title}</Text>
      <Text color={colors.text.primary}>{dialog.message}</Text>
      <Box marginTop={1} gap={2}>
        {dialog.actions.map(action => (
          <Text key={action.key}>
            <Text color={colors.text.accent}>[{action.key.toUpperCase()}]</Text> {action.label}
          </Text>
        ))}
        <Text color={colors.ui.comment}>[Esc] Dismiss</Text>
      </Box>
    </Box>
  )
}

// ─── DialogManager ───

export function DialogManager({ children }: { children: React.ReactNode }) {
  const [dialogQueue, setDialogQueue] = useState<Dialog[]>([])

  const showDialog = useCallback((dialog: Dialog) => {
    setDialogQueue(prev => {
      const next = [...prev, dialog]
      next.sort((a, b) => (b.priority ?? DialogPriority.Normal) - (a.priority ?? DialogPriority.Normal))
      return next
    })
  }, [])

  const dismissDialog = useCallback(() => {
    setDialogQueue(prev => prev.slice(1))
  }, [])

  const activeDialog = dialogQueue[0] ?? null

  return (
    <DialogContext.Provider value={{ showDialog, dismissDialog }}>
      {children}
      {activeDialog && (
        <DialogOverlay dialog={activeDialog} onDismiss={dismissDialog} />
      )}
    </DialogContext.Provider>
  )
}

export type { Dialog, DialogAction }
