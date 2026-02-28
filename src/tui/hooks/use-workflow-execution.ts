import { useCallback, useRef, useState } from 'react'
import { confirmPlan, rejectPlan } from '../../planner.js'
import { executeWorkflow } from '../../executor.js'
import { upsertWorkflow, updateWorkflowPhase } from '../../db.js'
import { logger } from '../../logger.js'
import type { Workflow } from '../../types.js'
import type { DaemonBridge } from '../daemon-bridge.js'
import type { ChatMessage } from '../ui-state-context.js'
import type Database from 'better-sqlite3'
import type { PlannerSession } from '../../planner-session.js'

type Dispatch = (action: any) => void

export function useWorkflowExecution(
  workflow: Workflow | null,
  db: Database.Database,
  cwd: string,
  bridgeRef: React.RefObject<DaemonBridge | null>,
  plannerSessionRef: React.RefObject<PlannerSession | null>,
  dispatch: Dispatch,
) {
  const abortRef = useRef<AbortController | null>(null)
  const abortMapRef = useRef<Map<string, AbortController>>(new Map())
  const [isExecuting, setIsExecuting] = useState(false)

  const handleConfirm = useCallback(async () => {
    if (!workflow) return
    const confirmed = confirmPlan(workflow)

    try {
      upsertWorkflow(db, confirmed)
    } catch (err) {
      logger.error({ err }, 'Failed to persist workflow')
    }

    const controller = new AbortController()
    abortRef.current = controller
    abortMapRef.current.set(confirmed.id, controller)
    setIsExecuting(true)
    if (plannerSessionRef.current) {
      (plannerSessionRef as React.MutableRefObject<PlannerSession | null>).current = null
    }

    dispatch({ type: 'SHOW_EXECUTION', workflow: confirmed })

    try {
      const result = await executeWorkflow({
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

      // Update step progress with final statuses from execution results
      for (const [stepId, stepResult] of result.results) {
        dispatch({ type: 'UPDATE_STEP', stepId, progress: { stepId, status: stepResult.status } })
      }

      if (result.status === 'failed') {
        const failedSteps = [...result.results.entries()]
          .filter(([, r]) => r.status === 'failed' && r.error)
          .map(([id, r]) => `${id}: ${r.error}`)
        const errorDetail = failedSteps.length > 0 ? `\n${failedSteps.join('\n')}` : ''
        dispatch({ type: 'ADD_MESSAGE', message: { type: 'error', text: `Workflow execution failed.${errorDetail}` } as ChatMessage })
      } else {
        const trigger = confirmed.trigger
        if (trigger.type === 'poll') {
          dispatch({ type: 'ADD_MESSAGE', message: { type: 'system', text: `Workflow completed first run. It will run every ${trigger.interval_seconds}s.` } as ChatMessage })
          const bridge = bridgeRef.current
          if (bridge?.triggerLoop && !bridge.isExternal) {
            bridge.triggerLoop.registerTrigger(confirmed)
          }
        } else if (trigger.type === 'cron') {
          dispatch({ type: 'ADD_MESSAGE', message: { type: 'system', text: `Workflow completed first run. Scheduled: ${trigger.expression}` } as ChatMessage })
          const bridge = bridgeRef.current
          if (bridge?.triggerLoop && !bridge.isExternal) {
            bridge.triggerLoop.registerTrigger(confirmed)
          }
        } else {
          dispatch({ type: 'ADD_MESSAGE', message: { type: 'system', text: 'Workflow execution completed.' } as ChatMessage })
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      dispatch({ type: 'ADD_MESSAGE', message: { type: 'error', text: `Execution failed: ${msg}` } as ChatMessage })
      logger.error({ err }, 'Workflow execution failed')
    } finally {
      abortMapRef.current.delete(confirmed.id)
      setIsExecuting(abortMapRef.current.size > 0)
    }
  }, [workflow, db, cwd])

  const handleExecutionAbort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const handleModify = useCallback(() => {
    dispatch({ type: 'SHOW_CHAT' })
    dispatch({ type: 'ADD_MESSAGE', message: { type: 'assistant', text: 'Describe your modifications:' } as ChatMessage })
  }, [])

  const handleCancel = useCallback(() => {
    if (workflow) {
      const rejected = rejectPlan(workflow)
      updateWorkflowPhase(db, workflow.id, rejected.phase)
    }
    if (plannerSessionRef.current) {
      (plannerSessionRef as React.MutableRefObject<PlannerSession | null>).current = null
    }
    dispatch({ type: 'SHOW_CHAT' })
    dispatch({ type: 'ADD_MESSAGE', message: { type: 'assistant', text: 'Plan cancelled.' } as ChatMessage })
  }, [workflow, db])

  const handleExecutionBack = useCallback(() => {
    dispatch({ type: 'SHOW_CHAT' })
  }, [])

  return {
    isExecuting,
    abortMapRef,
    handleConfirm,
    handleModify,
    handleCancel,
    handleExecutionAbort,
    handleExecutionBack,
  }
}
