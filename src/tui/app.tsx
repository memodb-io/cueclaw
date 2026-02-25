import { useReducer, useCallback } from 'react'
import { Box, useInput, useApp } from 'ink'
import { ThemeProvider } from '@inkjs/ui'
import { cueclawTheme } from './theme.js'
import { Banner } from './banner.js'
import { Chat, type ChatMessage } from './chat.js'
import { PlanView } from './plan-view.js'
import { Status } from './status.js'
import { ExecutionView, type StepProgress } from './execution-view.js'
import type { Workflow  } from '../types.js'
import { initDb } from '../db.js'
import { loadConfig } from '../config.js'
import { generatePlan, confirmPlan, rejectPlan } from '../planner.js'
import { executeWorkflow } from '../executor.js'
import { listWorkflows } from '../db.js'
import { logger } from '../logger.js'

type View = 'banner' | 'chat' | 'plan' | 'dashboard' | 'execution'

interface AppState {
  view: View
  messages: ChatMessage[]
  workflow: Workflow | null
  workflows: Workflow[]
  isGenerating: boolean
  stepProgress: Map<string, StepProgress>
  executionOutput: string[]
}

type AppAction =
  | { type: 'SHOW_CHAT' }
  | { type: 'SHOW_PLAN'; workflow: Workflow }
  | { type: 'SHOW_DASHBOARD'; workflows: Workflow[] }
  | { type: 'SHOW_EXECUTION'; workflow: Workflow }
  | { type: 'ADD_MESSAGE'; message: ChatMessage }
  | { type: 'SET_GENERATING'; value: boolean }
  | { type: 'UPDATE_STEP'; stepId: string; progress: StepProgress }
  | { type: 'ADD_OUTPUT'; line: string }

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SHOW_CHAT':
      return { ...state, view: 'chat' }
    case 'SHOW_PLAN':
      return { ...state, view: 'plan', workflow: action.workflow }
    case 'SHOW_DASHBOARD':
      return { ...state, view: 'dashboard', workflows: action.workflows }
    case 'SHOW_EXECUTION':
      return { ...state, view: 'execution', workflow: action.workflow, stepProgress: new Map(), executionOutput: [] }
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.message] }
    case 'SET_GENERATING':
      return { ...state, isGenerating: action.value }
    case 'UPDATE_STEP':
      return { ...state, stepProgress: new Map(state.stepProgress).set(action.stepId, action.progress) }
    case 'ADD_OUTPUT':
      return { ...state, executionOutput: [...state.executionOutput, action.line] }
    default:
      return state
  }
}

const initialState: AppState = {
  view: 'banner',
  messages: [],
  workflow: null,
  workflows: [],
  isGenerating: false,
  stepProgress: new Map(),
  executionOutput: [],
}

interface AppProps {
  noBanner?: boolean
  cwd: string
}

export function App({ noBanner, cwd }: AppProps) {
  const { exit } = useApp()
  const config = loadConfig()
  const db = initDb()

  const [state, dispatch] = useReducer(appReducer, {
    ...initialState,
    view: noBanner ? 'chat' : 'banner',
  })

  // Global keyboard shortcuts
  useInput((input, key) => {
    if (input === 'd' && key.ctrl) {
      const workflows = listWorkflows(db)
      dispatch({ type: 'SHOW_DASHBOARD', workflows })
    }
    if (input === 'c' && key.ctrl) {
      exit()
    }
  })

  const handleChatSubmit = useCallback(async (text: string) => {
    dispatch({ type: 'ADD_MESSAGE', message: { role: 'user', text } })
    dispatch({ type: 'SET_GENERATING', value: true })

    try {
      const workflow = await generatePlan(text, config)
      dispatch({ type: 'ADD_MESSAGE', message: { role: 'system', text: `Generated plan: "${workflow.name}"` } })
      dispatch({ type: 'SET_GENERATING', value: false })
      dispatch({ type: 'SHOW_PLAN', workflow })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      dispatch({ type: 'ADD_MESSAGE', message: { role: 'system', text: `Error: ${msg}` } })
      dispatch({ type: 'SET_GENERATING', value: false })
      logger.error({ err }, 'Plan generation failed')
    }
  }, [config])

  const handleConfirm = useCallback(async () => {
    if (!state.workflow) return
    const confirmed = confirmPlan(state.workflow)
    dispatch({ type: 'SHOW_EXECUTION', workflow: confirmed })

    try {
      await executeWorkflow({
        workflow: confirmed,
        triggerData: null,
        db,
        cwd,
        onProgress: (stepId, msg) => {
          dispatch({ type: 'UPDATE_STEP', stepId, progress: { stepId, status: 'running' } })
          if (typeof msg === 'string') {
            dispatch({ type: 'ADD_OUTPUT', line: msg })
          }
        },
      })
      dispatch({ type: 'ADD_MESSAGE', message: { role: 'system', text: 'Workflow execution completed.' } })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      dispatch({ type: 'ADD_MESSAGE', message: { role: 'system', text: `Execution failed: ${msg}` } })
      logger.error({ err }, 'Workflow execution failed')
    }
  }, [state.workflow, db, cwd])

  const handleModify = useCallback(() => {
    dispatch({ type: 'SHOW_CHAT' })
    dispatch({ type: 'ADD_MESSAGE', message: { role: 'system', text: 'Describe your modifications:' } })
  }, [])

  const handleCancel = useCallback(() => {
    if (state.workflow) {
      rejectPlan(state.workflow)
    }
    dispatch({ type: 'SHOW_CHAT' })
    dispatch({ type: 'ADD_MESSAGE', message: { role: 'system', text: 'Plan cancelled.' } })
  }, [state.workflow])

  const handleDashboardSelect = useCallback((workflow: Workflow) => {
    dispatch({ type: 'SHOW_EXECUTION', workflow })
  }, [])

  const handleDashboardBack = useCallback(() => {
    dispatch({ type: 'SHOW_CHAT' })
  }, [])

  return (
    <ThemeProvider theme={cueclawTheme}>
      <Box flexDirection="column">
        {state.view === 'banner' && (
          <Banner onComplete={() => dispatch({ type: 'SHOW_CHAT' })} />
        )}
        {state.view === 'chat' && (
          <Chat
            messages={state.messages}
            isGenerating={state.isGenerating}
            onSubmit={handleChatSubmit}
          />
        )}
        {state.view === 'plan' && state.workflow && (
          <PlanView
            workflow={state.workflow}
            onConfirm={handleConfirm}
            onModify={handleModify}
            onCancel={handleCancel}
          />
        )}
        {state.view === 'dashboard' && (
          <Status
            workflows={state.workflows}
            onSelect={handleDashboardSelect}
            onBack={handleDashboardBack}
          />
        )}
        {state.view === 'execution' && state.workflow && (
          <ExecutionView
            workflow={state.workflow}
            stepProgress={state.stepProgress}
            output={state.executionOutput}
          />
        )}
      </Box>
    </ThemeProvider>
  )
}
