import { createContext, useContext } from 'react'
import type { Workflow, WorkflowRun, StepRun } from '../types.js'
import type { StepProgress } from './execution-view.js'
import type { CueclawConfig } from '../config.js'

export type View = 'onboarding' | 'chat' | 'plan' | 'execution' | 'status' | 'detail'

export type ChatMessage =
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'assistant-jsx'; content: React.ReactNode }
  | { type: 'system'; text: string }
  | { type: 'error'; text: string }
  | { type: 'warning'; text: string }
  | { type: 'plan-ready'; workflowName: string }

export interface UIState {
  view: View
  messages: ChatMessage[]
  workflow: Workflow | null
  isGenerating: boolean
  stepProgress: Map<string, StepProgress>
  executionOutput: string[]
  streamingText: string
  daemonStatus: 'starting' | 'running' | 'external' | 'none'
  isExecuting: boolean
  config: CueclawConfig | null
  cwd: string
  footerExtra: string
  footerHints: string | undefined
  isConversing: boolean
  themeVersion: number
  statusWorkflows: Workflow[]
  detailRuns: WorkflowRun[]
  detailStepRuns: StepRun[]
}

export const UIStateContext = createContext<UIState | null>(null)

export function useUIState(): UIState {
  const ctx = useContext(UIStateContext)
  if (!ctx) throw new Error('useUIState must be used within an AppProvider')
  return ctx
}
