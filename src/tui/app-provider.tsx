import React, { useReducer, useCallback, useMemo, useState, useEffect } from 'react'
import { useApp } from 'ink'
import { useDialog } from './dialog-manager.js'
import type { Workflow, WorkflowRun, StepRun, StepStatus } from '../types.js'
import { initDb, listWorkflows, deleteWorkflow, getWorkflowRunsByWorkflowId, getStepRunsByRunId } from '../db.js'
import { loadConfig, validateConfig } from '../config.js'
import { onLogLine } from '../logger.js'
import type { CueclawConfig } from '../config.js'
import { UIStateContext, type UIState, type ChatMessage, type View } from './ui-state-context.js'
import { UIActionsContext, type UIActions } from './ui-actions-context.js'
import type { StepProgress } from './execution-view.js'
import { useDaemonBridge } from './hooks/use-daemon-bridge.js'
import { usePlannerSession } from './hooks/use-planner-session.js'
import { useWorkflowExecution } from './hooks/use-workflow-execution.js'
import { useGlobalKeypress } from './hooks/use-global-keypress.js'
import { useCommandDispatch } from './hooks/use-command-dispatch.js'
import { markSessionStart } from './hooks/exit-helpers.js'

// ─── Reducer ───

interface AppState {
  view: View
  previousView: View | null
  messages: ChatMessage[]
  workflow: Workflow | null
  isGenerating: boolean
  stepProgress: Map<string, StepProgress>
  executionOutput: string[]
  streamingText: string
  statusWorkflows: Workflow[]
  detailRuns: WorkflowRun[]
  detailStepRuns: StepRun[]
}

type AppAction =
  | { type: 'SHOW_CHAT' }
  | { type: 'SHOW_ONBOARDING' }
  | { type: 'SHOW_PLAN'; workflow: Workflow }
  | { type: 'SHOW_EXECUTION'; workflow: Workflow }
  | { type: 'SHOW_STATUS'; workflows: Workflow[] }
  | { type: 'SHOW_DETAIL'; workflow: Workflow; runs: WorkflowRun[]; stepRuns: StepRun[] }
  | { type: 'ADD_MESSAGE'; message: ChatMessage }
  | { type: 'SET_MESSAGES'; messages: ChatMessage[] }
  | { type: 'SET_GENERATING'; value: boolean }
  | { type: 'SET_STREAMING_TEXT'; text: string }
  | { type: 'UPDATE_STEP'; stepId: string; progress: StepProgress }
  | { type: 'ADD_OUTPUT'; line: string }

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SHOW_CHAT':
      return { ...state, view: 'chat', isGenerating: false, streamingText: '' }
    case 'SHOW_ONBOARDING':
      return { ...state, view: 'onboarding', isGenerating: false, streamingText: '' }
    case 'SHOW_PLAN':
      return { ...state, view: 'plan', workflow: action.workflow, isGenerating: false, streamingText: '' }
    case 'SHOW_EXECUTION':
      return { ...state, view: 'execution', previousView: state.view, workflow: action.workflow, stepProgress: new Map(), executionOutput: [], isGenerating: false, streamingText: '' }
    case 'SHOW_STATUS':
      return { ...state, view: 'status', statusWorkflows: action.workflows, isGenerating: false, streamingText: '' }
    case 'SHOW_DETAIL':
      return { ...state, view: 'detail', previousView: state.view, workflow: action.workflow, detailRuns: action.runs, detailStepRuns: action.stepRuns, isGenerating: false, streamingText: '' }
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.message] }
    case 'SET_MESSAGES':
      return { ...state, messages: action.messages }
    case 'SET_GENERATING':
      return { ...state, isGenerating: action.value }
    case 'SET_STREAMING_TEXT':
      return { ...state, streamingText: action.text }
    case 'UPDATE_STEP':
      return { ...state, stepProgress: new Map(state.stepProgress).set(action.stepId, action.progress) }
    case 'ADD_OUTPUT':
      return { ...state, executionOutput: [...state.executionOutput, action.line] }
    default:
      return state
  }
}

// ─── Provider ───

interface AppProviderProps {
  cwd: string
  skipOnboarding?: boolean
  children: React.ReactNode
}

export function AppProvider({ cwd, skipOnboarding, children }: AppProviderProps) {
  const { exit } = useApp()
  const { showDialog, dismissDialog } = useDialog()

  const validation = useMemo(() => validateConfig(), [])
  const needsSetup = !skipOnboarding && !validation.valid

  const [config, setConfig] = useState<CueclawConfig | null>(() => {
    if (needsSetup) return null
    try { return loadConfig() } catch { return null }
  })
  const db = useMemo(() => initDb(), [])
  const [themeVersion, setThemeVersion] = useState(0)

  const initialState: AppState = {
    view: needsSetup ? 'onboarding' : 'chat',
    previousView: null,
    messages: [],
    workflow: null,
    isGenerating: false,
    stepProgress: new Map(),
    executionOutput: [],
    streamingText: '',
    statusWorkflows: [],
    detailRuns: [],
    detailStepRuns: [],
  }

  const [state, dispatch] = useReducer(appReducer, initialState)

  // Record session start time for farewell message
  useEffect(() => { markSessionStart() }, [])

  // Subscribe to logger output
  useEffect(() => {
    return onLogLine((line) => {
      dispatch({ type: 'ADD_MESSAGE', message: { type: 'system', text: line } })
    })
  }, [])

  // Custom hooks
  const { bridgeRef, daemonStatus } = useDaemonBridge(config, db, cwd, dispatch)
  const planner = usePlannerSession(config, dispatch, state.streamingText)
  const execution = useWorkflowExecution(
    state.workflow, db, cwd, bridgeRef, planner.plannerSessionRef, dispatch,
  )
  const { handleSlashCommand } = useCommandDispatch({
    config, db, cwd, bridgeRef,
    plannerSessionRef: planner.plannerSessionRef,
    dispatch, setConfig, setThemeVersion,
    exit, showDialog, dismissDialog,
  })

  useGlobalKeypress({
    isExecuting: execution.isExecuting,
    bridgeRef,
    abortMapRef: execution.abortMapRef,
    db,
    view: state.view,
    exit,
    showDialog,
    dismissDialog,
    dispatch,
  })

  // ─── Handlers ───

  const handleOnboardingComplete = useCallback((newConfig: CueclawConfig) => {
    setConfig(newConfig)
    dispatch({ type: 'SHOW_CHAT' })
  }, [])

  const handleOnboardingCancel = useCallback(() => {
    try { setConfig(loadConfig()) } catch { /* keep current config */ }
    dispatch({ type: 'SHOW_CHAT' })
  }, [])

  const handleStatusBack = useCallback(() => {
    dispatch({ type: 'SHOW_CHAT' })
  }, [])

  const handleStatusSelect = useCallback((workflow: import('../types.js').Workflow) => {
    const runs = getWorkflowRunsByWorkflowId(db, workflow.id)
    const latestRun = runs[0]
    const stepRuns = latestRun ? getStepRunsByRunId(db, latestRun.id) : []
    dispatch({ type: 'SHOW_DETAIL', workflow, runs, stepRuns })
  }, [db])

  const handleStatusStop = useCallback((workflow: import('../types.js').Workflow) => {
    const controller = execution.abortMapRef.current.get(workflow.id)
    if (controller) {
      controller.abort()
      dispatch({ type: 'ADD_MESSAGE', message: { type: 'system', text: `Stopping workflow: ${workflow.name}` } as ChatMessage })
    } else {
      dispatch({ type: 'ADD_MESSAGE', message: { type: 'warning', text: `Workflow "${workflow.name}" is not currently executing.` } as ChatMessage })
    }
    const workflows = listWorkflows(db)
    dispatch({ type: 'SHOW_STATUS', workflows })
  }, [db, execution.abortMapRef])

  const handleStatusDelete = useCallback((workflow: import('../types.js').Workflow) => {
    deleteWorkflow(db, workflow.id)
    const updated = listWorkflows(db)
    dispatch({ type: 'SHOW_STATUS', workflows: updated })
  }, [db])

  const handleDetailBack = useCallback(() => {
    const workflows = listWorkflows(db)
    dispatch({ type: 'SHOW_STATUS', workflows })
  }, [db])

  const handleDetailSelectRun = useCallback((runId: string) => {
    if (!state.workflow) return
    dispatch({ type: 'SHOW_EXECUTION', workflow: state.workflow })

    // Populate step progress from the selected run
    const stepRuns = getStepRunsByRunId(db, runId)
    for (const sr of stepRuns) {
      dispatch({
        type: 'UPDATE_STEP',
        stepId: sr.step_id,
        progress: {
          stepId: sr.step_id,
          status: sr.status as StepStatus,
          duration: sr.duration_ms ?? undefined,
        },
      })
    }
  }, [db, state.workflow])

  const handleChatSubmit = useCallback(async (text: string) => {
    if (!config) return
    const wasCommand = await handleSlashCommand(text)
    if (!wasCommand) {
      await planner.handleUserMessage(text)
    }
  }, [config, handleSlashCommand, planner.handleUserMessage])

  // Footer status text
  const footerExtra = daemonStatus === 'external'
    ? ' | Background service detected'
    : daemonStatus === 'running'
      ? ' | Daemon active'
      : ''

  const footerHints = planner.isConversing
    ? 'Enter send \u00b7 /cancel abort \u00b7 /help commands'
    : undefined

  // ─── Context Values ───

  const handleExecutionBackWithNav = useCallback(() => {
    if (state.previousView === 'detail' && state.workflow) {
      const runs = getWorkflowRunsByWorkflowId(db, state.workflow.id)
      const latestRun = runs[0]
      const stepRuns = latestRun ? getStepRunsByRunId(db, latestRun.id) : []
      dispatch({ type: 'SHOW_DETAIL', workflow: state.workflow, runs, stepRuns })
    } else if (state.previousView === 'status') {
      const workflows = listWorkflows(db)
      dispatch({ type: 'SHOW_STATUS', workflows })
    } else {
      execution.handleExecutionBack()
    }
  }, [state.previousView, state.workflow, db, execution.handleExecutionBack])

  const uiState = useMemo<UIState>(() => ({
    view: state.view,
    messages: state.messages,
    workflow: state.workflow,
    isGenerating: state.isGenerating,
    stepProgress: state.stepProgress,
    executionOutput: state.executionOutput,
    streamingText: state.streamingText,
    daemonStatus,
    isExecuting: execution.isExecuting,
    config,
    cwd,
    footerExtra,
    footerHints,
    isConversing: planner.isConversing,
    themeVersion,
    statusWorkflows: state.statusWorkflows,
    detailRuns: state.detailRuns,
    detailStepRuns: state.detailStepRuns,
  }), [state, daemonStatus, execution.isExecuting, config, cwd, footerExtra, footerHints, planner.isConversing, themeVersion])

  const uiActions = useMemo<UIActions>(() => ({
    handleChatSubmit,
    handleCancelGeneration: planner.handleCancelGeneration,
    handleConfirm: execution.handleConfirm,
    handleModify: execution.handleModify,
    handleCancel: execution.handleCancel,
    handleExecutionAbort: execution.handleExecutionAbort,
    handleExecutionBack: handleExecutionBackWithNav,
    handleOnboardingComplete,
    handleOnboardingCancel,
    handleStatusBack,
    handleStatusSelect,
    handleStatusStop,
    handleStatusDelete,
    handleDetailBack,
    handleDetailSelectRun,
  }), [handleChatSubmit, planner.handleCancelGeneration, execution.handleConfirm, execution.handleModify, execution.handleCancel, execution.handleExecutionAbort, handleExecutionBackWithNav, handleOnboardingComplete, handleOnboardingCancel, handleStatusBack, handleStatusSelect, handleStatusStop, handleStatusDelete, handleDetailBack, handleDetailSelectRun])

  return (
    <UIStateContext.Provider value={uiState}>
      <UIActionsContext.Provider value={uiActions}>
        {children}
      </UIActionsContext.Provider>
    </UIStateContext.Provider>
  )
}
