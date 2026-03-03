import React, { useCallback, useRef } from 'react'
import { parseSlashCommand, findCommand } from '../commands/index.js'
import { cancelPlannerSession, type PlannerSession } from '../../planner-session.js'
import { listWorkflows, getWorkflow, getWorkflowRunsByWorkflowId, getStepRunsByRunId } from '../../db.js'
import { startBotChannels, type DaemonBridge } from '../daemon-bridge.js'
import { handleExit } from './exit-helpers.js'
import { WorkflowDetail } from '../renderers.js'
import type { CueclawConfig } from '../../config.js'
import type { CommandContext } from '../commands/types.js'
import type { ChatMessage } from '../ui-state-context.js'
import type Database from 'better-sqlite3'
import type { AppAction } from '../app-provider.js'
import type { Dialog } from '../dialog-manager.js'

type Dispatch = (action: AppAction) => void

interface UseCommandDispatchOptions {
  config: CueclawConfig | null
  db: Database.Database
  cwd: string
  bridgeRef: React.RefObject<DaemonBridge | null>
  plannerSessionRef: React.MutableRefObject<PlannerSession | null>
  dispatch: Dispatch
  setConfig: (config: CueclawConfig | null) => void
  setThemeVersion: React.Dispatch<React.SetStateAction<number>>
  exit: () => void
  showDialog: (dialog: Dialog) => void
  dismissDialog: () => void
}

export function useCommandDispatch({
  config,
  db,
  cwd,
  bridgeRef,
  plannerSessionRef,
  dispatch,
  setConfig,
  setThemeVersion,
  exit,
  showDialog,
  dismissDialog,
}: UseCommandDispatchOptions) {
  const commandCtxRef = useRef<CommandContext>(null!)
  commandCtxRef.current = {
    db,
    config,
    cwd,
    bridge: bridgeRef.current,
    addMessage: (msg: ChatMessage) => dispatch({ type: 'ADD_MESSAGE', message: msg }),
    clearMessages: () => dispatch({ type: 'SET_MESSAGES', messages: [] }),
    setConfig: setConfig as (config: CueclawConfig) => void,
    setThemeVersion,
  }

  const handleSlashCommand = useCallback(async (text: string): Promise<boolean> => {
    if (!config) return false

    const parsed = parseSlashCommand(text)
    if (!parsed) return false

    const commandCtx = commandCtxRef.current

    dispatch({ type: 'ADD_MESSAGE', message: { type: 'user', text } as ChatMessage })

    // Special handling for /cancel — reset planner session
    if (parsed.name === 'cancel') {
      if (plannerSessionRef.current) {
        cancelPlannerSession(plannerSessionRef.current)
        plannerSessionRef.current = null
      }
      dispatch({ type: 'ADD_MESSAGE', message: { type: 'assistant', text: 'Conversation cancelled.' } as ChatMessage })
      return true
    }

    // Special handling for /new — single-shot plan generation
    if (parsed.name === 'new' && !parsed.args) {
      dispatch({ type: 'ADD_MESSAGE', message: { type: 'assistant', text: 'Usage: /new <workflow description>' } as ChatMessage })
      return true
    }
    if (parsed.name === 'new' && parsed.args) {
      plannerSessionRef.current = null
      dispatch({ type: 'SET_GENERATING', value: true })
      dispatch({ type: 'SET_STREAMING_TEXT', text: '' })
      try {
        const { generatePlan } = await import('../../planner.js')
        const workflow = await generatePlan(parsed.args, config, { channel: 'tui' })
        dispatch({ type: 'ADD_MESSAGE', message: { type: 'plan-ready', workflowName: workflow.name } as ChatMessage })
        dispatch({ type: 'SET_GENERATING', value: false })
        dispatch({ type: 'SHOW_PLAN', workflow })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'ADD_MESSAGE', message: { type: 'error', text: `Error: ${msg}` } as ChatMessage })
        dispatch({ type: 'SET_GENERATING', value: false })
      }
      return true
    }

    // /list or /status (no args) — navigate to status view
    if (parsed.name === 'list' || parsed.name === 'ls' || ((parsed.name === 'status' || parsed.name === 'st') && !parsed.args)) {
      const workflows = listWorkflows(db)
      dispatch({ type: 'SHOW_STATUS', workflows })
      return true
    }

    // /status <id> — show workflow detail inline
    if ((parsed.name === 'status' || parsed.name === 'st') && parsed.args) {
      const wf = getWorkflow(db, parsed.args) ?? listWorkflows(db).find(w => w.id.startsWith(parsed.args))
      if (wf) {
        const runs = getWorkflowRunsByWorkflowId(db, wf.id)
        const latestRun = runs[0]
        const stepRuns = latestRun ? getStepRunsByRunId(db, latestRun.id) : undefined
        dispatch({
          type: 'ADD_MESSAGE',
          message: {
            type: 'assistant-jsx',
            content: React.createElement(WorkflowDetail, { workflow: wf, latestRun, stepRuns }),
          },
        })
        return true
      }
      dispatch({ type: 'ADD_MESSAGE', message: { type: 'assistant', text: `Workflow not found: ${parsed.args}` } as ChatMessage })
      return true
    }

    // Special handling for /clear
    if (parsed.name === 'clear' || parsed.name === 'cls') {
      dispatch({ type: 'SET_MESSAGES', messages: [] })
      return true
    }

    // Special handling for /bot start
    if (parsed.name === 'bot' && parsed.args.trim().toLowerCase() === 'start') {
      const bridge = bridgeRef.current
      if (bridge && config) {
        dispatch({ type: 'ADD_MESSAGE', message: { type: 'system', text: 'Starting bot channels...' } as ChatMessage })
        try {
          await startBotChannels(bridge, config)
          dispatch({ type: 'ADD_MESSAGE', message: { type: 'system', text: 'Bot channels started.' } as ChatMessage })
        } catch (err) {
          dispatch({ type: 'ADD_MESSAGE', message: { type: 'error', text: `Failed to start bots: ${err instanceof Error ? err.message : String(err)}` } as ChatMessage })
        }
      } else {
        dispatch({ type: 'ADD_MESSAGE', message: { type: 'error', text: 'Daemon not running. Cannot start bots.' } as ChatMessage })
      }
      return true
    }

    // Special handling for /setup — switch to onboarding view (keep config for cancel path)
    if (parsed.name === 'setup') {
      dispatch({ type: 'SET_MESSAGES', messages: [] })
      dispatch({ type: 'SHOW_ONBOARDING' })
      return true
    }

    // Special handling for /quit and /exit
    if (parsed.name === 'quit' || parsed.name === 'exit' || parsed.name === 'q') {
      handleExit({ bridgeRef, exit, showDialog, dismissDialog })
      return true
    }

    // General command dispatch
    const cmd = findCommand(parsed.name)
    if (cmd) {
      await cmd.execute(parsed.args, commandCtx)
    } else {
      dispatch({ type: 'ADD_MESSAGE', message: { type: 'assistant', text: `Unknown command: /${parsed.name}. Type /help for available commands.` } as ChatMessage })
    }
    return true
  }, [config, db, exit, showDialog, dismissDialog])

  return { handleSlashCommand }
}
