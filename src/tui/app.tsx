import React, { useReducer, useCallback, useMemo, useState, useEffect, useRef } from 'react'
import { Box, Text, Static, useInput, useApp, useStdout } from 'ink'
import { ThemeProvider, ConfirmInput } from '@inkjs/ui'
import { cueclawTheme } from './theme.js'
import { Chat, type ChatMessage } from './chat.js'
import { PlanView } from './plan-view.js'
import { ExecutionView, type StepProgress } from './execution-view.js'
import { Onboarding } from './onboarding.js'
import { WorkflowTable, WorkflowDetail } from './renderers.js'
import type { Workflow  } from '../types.js'
import { initDb, insertWorkflow } from '../db.js'
import { loadConfig, validateConfig } from '../config.js'
import { confirmPlan, rejectPlan } from '../planner.js'
import { executeWorkflow } from '../executor.js'
import { listWorkflows, getWorkflow, getWorkflowRunsByWorkflowId, getStepRunsByRunId } from '../db.js'
import { logger, onLogLine } from '../logger.js'
import { initDaemonBridge, stopDaemonBridge, startBotChannels, type DaemonBridge } from './daemon-bridge.js'
import type { CueclawConfig } from '../config.js'
import { appVersion } from './version.js'
import { parseSlashCommand, findCommand, type CommandContext } from './commands.js'
import {
  startPlannerSession,
  continuePlannerSession,
  cancelPlannerSession,
  type PlannerSession,
} from '../planner-session.js'

type View = 'onboarding' | 'chat' | 'plan' | 'execution' | 'exit_prompt'

interface AppState {
  view: View
  messages: ChatMessage[]
  workflow: Workflow | null
  isGenerating: boolean
  stepProgress: Map<string, StepProgress>
  executionOutput: string[]
  streamingText: string
}

type AppAction =
  | { type: 'SHOW_CHAT' }
  | { type: 'SHOW_ONBOARDING' }
  | { type: 'SHOW_PLAN'; workflow: Workflow }
  | { type: 'SHOW_EXECUTION'; workflow: Workflow }
  | { type: 'SHOW_EXIT_PROMPT' }
  | { type: 'ADD_MESSAGE'; message: ChatMessage }
  | { type: 'SET_MESSAGES'; messages: ChatMessage[] }
  | { type: 'SET_GENERATING'; value: boolean }
  | { type: 'SET_STREAMING_TEXT'; text: string }
  | { type: 'UPDATE_STEP'; stepId: string; progress: StepProgress }
  | { type: 'ADD_OUTPUT'; line: string }

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SHOW_CHAT':
      return { ...state, view: 'chat' }
    case 'SHOW_ONBOARDING':
      return { ...state, view: 'onboarding' }
    case 'SHOW_PLAN':
      return { ...state, view: 'plan', workflow: action.workflow }
    case 'SHOW_EXECUTION':
      return { ...state, view: 'execution', workflow: action.workflow, stepProgress: new Map(), executionOutput: [] }
    case 'SHOW_EXIT_PROMPT':
      return { ...state, view: 'exit_prompt' }
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

interface AppProps {
  cwd: string
  skipOnboarding?: boolean
}

export function App({ cwd, skipOnboarding }: AppProps) {
  const { exit } = useApp()

  // Phase 3: Use validateConfig() instead of needsOnboarding()
  const validation = useMemo(() => validateConfig(), [])
  const needsSetup = !skipOnboarding && !validation.valid
  const configIssues = validation.issues.filter(i => i.severity === 'error')

  const [config, setConfig] = useState<CueclawConfig | null>(() => {
    if (needsSetup) return null
    try { return loadConfig() } catch { return null }
  })
  const db = useMemo(() => initDb(), [])
  const bridgeRef = useRef<DaemonBridge | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const abortMapRef = useRef<Map<string, AbortController>>(new Map())
  const [isExecuting, setIsExecuting] = useState(false)
  const [daemonStatus, setDaemonStatus] = useState<'starting' | 'running' | 'external' | 'none'>('none')

  // Phase 2: Planner session state
  const plannerSessionRef = useRef<PlannerSession | null>(null)

  // Subscribe to logger output
  useEffect(() => {
    return onLogLine((line) => {
      dispatch({ type: 'ADD_MESSAGE', message: { role: 'system', text: line } })
    })
  }, [])

  const initialState: AppState = {
    view: needsSetup ? 'onboarding' : 'chat',
    messages: [],
    workflow: null,
    isGenerating: false,
    stepProgress: new Map(),
    executionOutput: [],
    streamingText: '',
  }

  const [state, dispatch] = useReducer(appReducer, initialState)

  // Detect configured bot channels
  const hasConfiguredBots = !!(
    (config?.telegram?.enabled && config?.telegram?.token) ||
    config?.whatsapp?.enabled
  )

  // Phase 3: Start daemon bridge when config is ready + bot prompt in chat
  useEffect(() => {
    if (!config) return

    let cancelled = false
    setDaemonStatus('starting')
    dispatch({ type: 'ADD_MESSAGE', message: { role: 'system', text: 'Starting daemon...' } })

    initDaemonBridge(db, config, cwd, { skipBots: true }).then(bridge => {
      if (cancelled) {
        stopDaemonBridge(bridge)
        return
      }
      bridgeRef.current = bridge
      setDaemonStatus(bridge.isExternal ? 'external' : 'running')
      dispatch({ type: 'ADD_MESSAGE', message: { role: 'system', text: bridge.isExternal ? 'Background service detected.' : 'Daemon started.' } })

      // Phase 3: Bot prompt as chat message instead of separate view
      if (!bridge.isExternal && hasConfiguredBots) {
        const botList: string[] = []
        if (config.telegram?.enabled && config.telegram?.token) botList.push('Telegram')
        if (config.whatsapp?.enabled) botList.push('WhatsApp')
        dispatch({
          type: 'ADD_MESSAGE',
          message: { role: 'assistant', text: `${botList.join(' and ')} bot${botList.length > 1 ? 's are' : ' is'} configured. Type /bot start to launch.` },
        })
      }
    }).catch(err => {
      logger.error({ err }, 'Failed to start daemon bridge')
      setDaemonStatus('none')
      dispatch({ type: 'ADD_MESSAGE', message: { role: 'system', text: 'Failed to start daemon.' } })
    })

    return () => {
      cancelled = true
      if (bridgeRef.current) {
        stopDaemonBridge(bridgeRef.current)
        bridgeRef.current = null
      }
    }
  }, [config, db, cwd])

  // Global keyboard shortcuts
  useInput((input, key) => {
    if (input === 'c' && key.ctrl) {
      const bridge = bridgeRef.current
      const hasRunning = isExecuting || (bridge && !bridge.isExternal)
      if (hasRunning && state.view !== 'exit_prompt') {
        dispatch({ type: 'SHOW_EXIT_PROMPT' })
        return
      }
      if (bridge) {
        stopDaemonBridge(bridge).finally(() => {
          exit()
          process.exit(0)
        })
      } else {
        exit()
        process.exit(0)
      }
    }

    if (state.view === 'onboarding' || state.view === 'exit_prompt') return

    // Phase 4: Ctrl+D runs /list inline instead of switching to dashboard view
    if (input === 'd' && key.ctrl) {
      const workflows = listWorkflows(db)
      dispatch({
        type: 'ADD_MESSAGE',
        message: {
          role: 'assistant',
          content: React.createElement(WorkflowTable, { workflows }),
        },
      })
    }
  })

  // ─── Command Context ───

  const commandCtx = useMemo<CommandContext>(() => ({
    db,
    config,
    cwd,
    bridge: bridgeRef.current,
    addMessage: (msg: ChatMessage) => dispatch({ type: 'ADD_MESSAGE', message: msg }),
    clearMessages: () => dispatch({ type: 'SET_MESSAGES', messages: [] }),
    setConfig,
  }), [db, config, cwd])

  // ─── Handlers ───

  const handleOnboardingComplete = useCallback((newConfig: CueclawConfig) => {
    setConfig(newConfig)
    dispatch({ type: 'SHOW_CHAT' })
  }, [])

  const handleChatSubmit = useCallback(async (text: string) => {
    if (!config) return

    // Phase 1: Check for slash commands
    const parsed = parseSlashCommand(text)
    if (parsed) {
      dispatch({ type: 'ADD_MESSAGE', message: { role: 'user', text } })

      // Special handling for /cancel — reset planner session
      if (parsed.name === 'cancel') {
        if (plannerSessionRef.current) {
          cancelPlannerSession(plannerSessionRef.current)
          plannerSessionRef.current = null
        }
        dispatch({ type: 'ADD_MESSAGE', message: { role: 'assistant', text: 'Conversation cancelled.' } })
        return
      }

      // Special handling for /new — single-shot plan generation
      if (parsed.name === 'new' && !parsed.args) {
        dispatch({ type: 'ADD_MESSAGE', message: { role: 'assistant', text: 'Usage: /new <workflow description>' } })
        return
      }
      if (parsed.name === 'new' && parsed.args) {
        plannerSessionRef.current = null
        dispatch({ type: 'SET_GENERATING', value: true })
        dispatch({ type: 'SET_STREAMING_TEXT', text: '' })
        try {
          const { generatePlan } = await import('../planner.js')
          const workflow = await generatePlan(parsed.args, config)
          dispatch({ type: 'ADD_MESSAGE', message: { role: 'system', text: `Generated plan: "${workflow.name}"` } })
          dispatch({ type: 'SET_GENERATING', value: false })
          dispatch({ type: 'SHOW_PLAN', workflow })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          dispatch({ type: 'ADD_MESSAGE', message: { role: 'assistant', text: `Error: ${msg}` } })
          dispatch({ type: 'SET_GENERATING', value: false })
        }
        return
      }

      // Special handling for /list with JSX rendering (Phase 4)
      if (parsed.name === 'list' || parsed.name === 'ls') {
        const workflows = listWorkflows(db)
        dispatch({
          type: 'ADD_MESSAGE',
          message: {
            role: 'assistant',
            content: React.createElement(WorkflowTable, { workflows }),
          },
        })
        return
      }

      // Special handling for /status with JSX rendering (Phase 4)
      if ((parsed.name === 'status' || parsed.name === 'st') && parsed.args) {
        const wf = getWorkflow(db, parsed.args) ?? listWorkflows(db).find(w => w.id.startsWith(parsed.args))
        if (wf) {
          const runs = getWorkflowRunsByWorkflowId(db, wf.id)
          const latestRun = runs[0]
          const stepRuns = latestRun ? getStepRunsByRunId(db, latestRun.id) : undefined
          dispatch({
            type: 'ADD_MESSAGE',
            message: {
              role: 'assistant',
              content: React.createElement(WorkflowDetail, { workflow: wf, latestRun, stepRuns }),
            },
          })
          return
        }
        dispatch({ type: 'ADD_MESSAGE', message: { role: 'assistant', text: `Workflow not found: ${parsed.args}` } })
        return
      }

      // Special handling for /clear
      if (parsed.name === 'clear' || parsed.name === 'cls') {
        dispatch({ type: 'SET_MESSAGES', messages: [] })
        return
      }

      // Special handling for /bot start
      if (parsed.name === 'bot' && parsed.args.trim().toLowerCase() === 'start') {
        const bridge = bridgeRef.current
        if (bridge && config) {
          dispatch({ type: 'ADD_MESSAGE', message: { role: 'system', text: 'Starting bot channels...' } })
          try {
            await startBotChannels(bridge, config)
            dispatch({ type: 'ADD_MESSAGE', message: { role: 'system', text: 'Bot channels started.' } })
          } catch (err) {
            dispatch({ type: 'ADD_MESSAGE', message: { role: 'assistant', text: `Failed to start bots: ${err instanceof Error ? err.message : String(err)}` } })
          }
        } else {
          dispatch({ type: 'ADD_MESSAGE', message: { role: 'assistant', text: 'Daemon not running. Cannot start bots.' } })
        }
        return
      }

      // Special handling for /setup — switch to onboarding view
      if (parsed.name === 'setup') {
        dispatch({ type: 'ADD_MESSAGE', message: { role: 'system', text: 'Starting setup wizard...' } })
        setConfig(null)
        dispatch({ type: 'SET_MESSAGES', messages: [] })
        dispatch({ type: 'SHOW_ONBOARDING' })
        return
      }

      // General command dispatch
      const cmd = findCommand(parsed.name)
      if (cmd) {
        // Update bridge ref in context
        commandCtx.bridge = bridgeRef.current
        commandCtx.config = config
        await cmd.execute(parsed.args, commandCtx)
      } else {
        dispatch({ type: 'ADD_MESSAGE', message: { role: 'assistant', text: `Unknown command: /${parsed.name}. Type /help for available commands.` } })
      }
      return
    }

    // Phase 2: Multi-turn planner conversation
    dispatch({ type: 'ADD_MESSAGE', message: { role: 'user', text } })
    dispatch({ type: 'SET_GENERATING', value: true })
    dispatch({ type: 'SET_STREAMING_TEXT', text: '' })

    try {
      let result: { session: PlannerSession; turn: import('../planner-session.js').PlannerTurn }

      if (plannerSessionRef.current && plannerSessionRef.current.status === 'conversing') {
        // Continue existing conversation
        result = await continuePlannerSession(
          plannerSessionRef.current,
          text,
          config,
          {
            onToken: (token) => {
              dispatch({ type: 'SET_STREAMING_TEXT', text: (state.streamingText || '') + token })
            },
          },
        )
      } else {
        // Start new conversation
        result = await startPlannerSession(
          text,
          config,
          {
            onToken: (token) => {
              dispatch({ type: 'SET_STREAMING_TEXT', text: (state.streamingText || '') + token })
            },
          },
        )
      }

      plannerSessionRef.current = result.session
      dispatch({ type: 'SET_STREAMING_TEXT', text: '' })

      switch (result.turn.type) {
        case 'question':
          dispatch({ type: 'ADD_MESSAGE', message: { role: 'assistant', text: result.turn.content } })
          dispatch({ type: 'SET_GENERATING', value: false })
          break

        case 'plan':
          if (result.turn.workflow) {
            dispatch({ type: 'ADD_MESSAGE', message: { role: 'system', text: `Generated plan: "${result.turn.workflow.name}"` } })
            dispatch({ type: 'SET_GENERATING', value: false })
            dispatch({ type: 'SHOW_PLAN', workflow: result.turn.workflow })
          }
          break

        case 'text':
          dispatch({ type: 'ADD_MESSAGE', message: { role: 'assistant', text: result.turn.content } })
          dispatch({ type: 'SET_GENERATING', value: false })
          break

        case 'error':
          dispatch({ type: 'ADD_MESSAGE', message: { role: 'assistant', text: `Error: ${result.turn.content}` } })
          dispatch({ type: 'SET_GENERATING', value: false })
          plannerSessionRef.current = null
          break
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      dispatch({ type: 'ADD_MESSAGE', message: { role: 'assistant', text: `Error: ${msg}` } })
      dispatch({ type: 'SET_GENERATING', value: false })
      dispatch({ type: 'SET_STREAMING_TEXT', text: '' })
      plannerSessionRef.current = null
      logger.error({ err }, 'Planner session failed')
    }
  }, [config, db, commandCtx, state.streamingText])

  const handleConfirm = useCallback(async () => {
    if (!state.workflow) return
    const confirmed = confirmPlan(state.workflow)

    try {
      insertWorkflow(db, confirmed)
    } catch (err) {
      logger.error({ err }, 'Failed to persist workflow')
    }

    const controller = new AbortController()
    abortRef.current = controller
    abortMapRef.current.set(confirmed.id, controller)
    setIsExecuting(true)
    plannerSessionRef.current = null

    dispatch({ type: 'SHOW_EXECUTION', workflow: confirmed })

    try {
      await executeWorkflow({
        workflow: confirmed,
        triggerData: null,
        db,
        cwd,
        signal: controller.signal,
        onProgress: (stepId, msg) => {
          if (typeof msg === 'object' && msg !== null && 'status' in msg) {
            dispatch({ type: 'UPDATE_STEP', stepId, progress: { stepId, status: msg.status } })
          } else {
            dispatch({ type: 'UPDATE_STEP', stepId, progress: { stepId, status: 'running' } })
            if (typeof msg === 'string') {
              dispatch({ type: 'ADD_OUTPUT', line: msg })
            }
          }
        },
      })

      const trigger = confirmed.trigger
      if (trigger.type === 'poll') {
        dispatch({ type: 'ADD_MESSAGE', message: { role: 'system', text: `Workflow completed first run. It will run every ${trigger.interval_seconds}s.` } })
        const bridge = bridgeRef.current
        if (bridge?.triggerLoop && !bridge.isExternal) {
          bridge.triggerLoop.registerTrigger(confirmed)
        }
      } else if (trigger.type === 'cron') {
        dispatch({ type: 'ADD_MESSAGE', message: { role: 'system', text: `Workflow completed first run. Scheduled: ${trigger.expression}` } })
        const bridge = bridgeRef.current
        if (bridge?.triggerLoop && !bridge.isExternal) {
          bridge.triggerLoop.registerTrigger(confirmed)
        }
      } else {
        dispatch({ type: 'ADD_MESSAGE', message: { role: 'system', text: 'Workflow execution completed.' } })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      dispatch({ type: 'ADD_MESSAGE', message: { role: 'system', text: `Execution failed: ${msg}` } })
      logger.error({ err }, 'Workflow execution failed')
    } finally {
      abortMapRef.current.delete(confirmed.id)
      setIsExecuting(abortMapRef.current.size > 0)
    }
  }, [state.workflow, db, cwd])

  const handleModify = useCallback(() => {
    dispatch({ type: 'SHOW_CHAT' })
    dispatch({ type: 'ADD_MESSAGE', message: { role: 'assistant', text: 'Describe your modifications:' } })
  }, [])

  const handleCancel = useCallback(() => {
    if (state.workflow) {
      rejectPlan(state.workflow)
    }
    plannerSessionRef.current = null
    dispatch({ type: 'SHOW_CHAT' })
    dispatch({ type: 'ADD_MESSAGE', message: { role: 'assistant', text: 'Plan cancelled.' } })
  }, [state.workflow])

  const handleExecutionAbort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const handleExecutionBack = useCallback(() => {
    dispatch({ type: 'SHOW_CHAT' })
  }, [])

  const handleExitInstall = useCallback(async () => {
    try {
      const { installService } = await import('../service.js')
      const result = installService()
      if (result.success) {
        logger.info('System service installed')
      }
    } catch (err) {
      logger.error({ err }, 'Failed to install service')
    }
    const bridge = bridgeRef.current
    if (bridge) await stopDaemonBridge(bridge)
    exit()
    process.exit(0)
  }, [exit])

  const handleExitNoInstall = useCallback(async () => {
    for (const controller of abortMapRef.current.values()) {
      controller.abort()
    }
    const bridge = bridgeRef.current
    if (bridge) await stopDaemonBridge(bridge)
    exit()
    process.exit(0)
  }, [exit])

  const { stdout } = useStdout()

  // Footer status text
  const footerExtra = daemonStatus === 'external'
    ? ' | Background service detected'
    : daemonStatus === 'running'
      ? ' | Daemon active'
      : ''

  // Dynamic footer hints based on state
  const footerHints = plannerSessionRef.current?.status === 'conversing'
    ? 'Enter send · /cancel abort · /help commands'
    : undefined

  const displayPath = cwd ? cwd.replace(process.env['HOME'] ?? '', '~') : ''
  const versionLabel = appVersion === 'dev' ? 'dev' : `v${appVersion}`

  const rows = stdout?.rows ?? 24

  return (
    <ThemeProvider theme={cueclawTheme}>
      <Box flexDirection="column" height={rows}>
        {/* Title */}
        <Static items={state.view !== 'onboarding' ? ['banner'] : []}>
          {(item) => (
            <Box key={item} flexDirection="column" paddingX={1} paddingY={1}>
              <Text color="cyan" bold>CueClaw</Text>
              <Text dimColor>{versionLabel} · {displayPath}</Text>
            </Box>
          )}
        </Static>

        {state.view === 'onboarding' && (
          <Onboarding onComplete={handleOnboardingComplete} issues={configIssues} />
        )}
        {state.view === 'chat' && (
          <Chat
            messages={state.messages}
            isGenerating={state.isGenerating}
            onSubmit={handleChatSubmit}
            footerExtra={footerExtra}
            footerHints={footerHints}
            streamingText={state.streamingText || undefined}
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
        {state.view === 'execution' && state.workflow && (
          <ExecutionView
            workflow={state.workflow}
            stepProgress={state.stepProgress}
            output={state.executionOutput}
            onBack={handleExecutionBack}
            onAbort={handleExecutionAbort}
          />
        )}
        {state.view === 'exit_prompt' && (
          <Box flexDirection="column" paddingX={1} flexGrow={1}>
            <Box flexDirection="column" flexGrow={1}>
              {isExecuting && (
                <Text bold color="yellow">A workflow is currently running. It will be cancelled if you exit.</Text>
              )}
              {bridgeRef.current && !bridgeRef.current.isExternal ? (
                <>
                  <Text bold>Install as background service?</Text>
                  <Text dimColor>This lets poll/cron workflows keep running after you exit.</Text>
                </>
              ) : (
                <Text bold>Are you sure you want to exit?</Text>
              )}
            </Box>

            <Box marginTop={1}>
              {bridgeRef.current && !bridgeRef.current.isExternal ? (
                <ConfirmInput onConfirm={handleExitInstall} onCancel={handleExitNoInstall} />
              ) : (
                <ConfirmInput
                  onConfirm={handleExitNoInstall}
                  onCancel={() => dispatch({ type: 'SHOW_CHAT' })}
                />
              )}
            </Box>
          </Box>
        )}
      </Box>
    </ThemeProvider>
  )
}
