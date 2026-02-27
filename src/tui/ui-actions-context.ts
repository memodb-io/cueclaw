import { createContext, useContext } from 'react'
import type { CueclawConfig } from '../config.js'
import type { Workflow } from '../types.js'

export interface UIActions {
  handleChatSubmit: (text: string) => Promise<void>
  handleCancelGeneration: () => void
  handleConfirm: () => Promise<void>
  handleModify: () => void
  handleCancel: () => void
  handleExecutionAbort: () => void
  handleExecutionBack: () => void
  handleOnboardingComplete: (config: CueclawConfig) => void
  handleOnboardingCancel: () => void
  handleStatusBack: () => void
  handleStatusSelect: (workflow: Workflow) => void
  handleStatusStop: (workflow: Workflow) => void
  handleStatusDelete: (workflow: Workflow) => void
  handleDetailBack: () => void
  handleDetailSelectRun: (runId: string) => void
}

export const UIActionsContext = createContext<UIActions | null>(null)

export function useUIActions(): UIActions {
  const ctx = useContext(UIActionsContext)
  if (!ctx) throw new Error('useUIActions must be used within an AppProvider')
  return ctx
}
