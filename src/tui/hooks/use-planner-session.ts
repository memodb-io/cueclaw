import { useCallback, useRef } from 'react'
import {
  startPlannerSession,
  continuePlannerSession,
  cancelPlannerSession,
  type PlannerSession,
} from '../../planner-session.js'
import { logger } from '../../logger.js'
import type { CueclawConfig } from '../../config.js'
import type { ChatMessage } from '../ui-state-context.js'

type Dispatch = (action: any) => void

export function usePlannerSession(
  config: CueclawConfig | null,
  dispatch: Dispatch,
  streamingText: string,
) {
  const plannerSessionRef = useRef<PlannerSession | null>(null)

  const handleUserMessage = useCallback(async (text: string) => {
    if (!config) return

    dispatch({ type: 'ADD_MESSAGE', message: { type: 'user', text } as ChatMessage })
    dispatch({ type: 'SET_GENERATING', value: true })
    dispatch({ type: 'SET_STREAMING_TEXT', text: '' })

    try {
      let result: { session: PlannerSession; turn: import('../../planner-session.js').PlannerTurn }

      const tuiContext = { channel: 'tui' as const }
      if (plannerSessionRef.current && plannerSessionRef.current.status === 'conversing') {
        result = await continuePlannerSession(
          plannerSessionRef.current,
          text,
          config,
          {
            onToken: (token) => {
              dispatch({ type: 'SET_STREAMING_TEXT', text: (streamingText || '') + token })
            },
          },
          tuiContext,
        )
      } else {
        result = await startPlannerSession(
          text,
          config,
          {
            onToken: (token) => {
              dispatch({ type: 'SET_STREAMING_TEXT', text: (streamingText || '') + token })
            },
          },
          tuiContext,
        )
      }

      plannerSessionRef.current = result.session
      dispatch({ type: 'SET_STREAMING_TEXT', text: '' })

      switch (result.turn.type) {
        case 'question':
          dispatch({ type: 'ADD_MESSAGE', message: { type: 'assistant', text: result.turn.content } as ChatMessage })
          dispatch({ type: 'SET_GENERATING', value: false })
          break

        case 'plan':
          if (result.turn.workflow) {
            dispatch({ type: 'ADD_MESSAGE', message: { type: 'plan-ready', workflowName: result.turn.workflow.name } as ChatMessage })
            dispatch({ type: 'SET_GENERATING', value: false })
            dispatch({ type: 'SHOW_PLAN', workflow: result.turn.workflow })
          }
          break

        case 'text':
          dispatch({ type: 'ADD_MESSAGE', message: { type: 'assistant', text: result.turn.content } as ChatMessage })
          dispatch({ type: 'SET_GENERATING', value: false })
          break

        case 'error':
          dispatch({ type: 'ADD_MESSAGE', message: { type: 'error', text: `Error: ${result.turn.content}` } as ChatMessage })
          dispatch({ type: 'SET_GENERATING', value: false })
          plannerSessionRef.current = null
          break
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      dispatch({ type: 'ADD_MESSAGE', message: { type: 'error', text: `Error: ${msg}` } as ChatMessage })
      dispatch({ type: 'SET_GENERATING', value: false })
      dispatch({ type: 'SET_STREAMING_TEXT', text: '' })
      plannerSessionRef.current = null
      logger.error({ err }, 'Planner session failed')
    }
  }, [config, streamingText])

  const handleCancelGeneration = useCallback(() => {
    if (plannerSessionRef.current) {
      cancelPlannerSession(plannerSessionRef.current)
      plannerSessionRef.current = null
    }
    dispatch({ type: 'SET_STREAMING_TEXT', text: '' })
    dispatch({ type: 'SET_GENERATING', value: false })
    dispatch({ type: 'ADD_MESSAGE', message: { type: 'system', text: 'Generation cancelled.' } as ChatMessage })
  }, [])

  const isConversing = plannerSessionRef.current?.status === 'conversing'

  return { plannerSessionRef, handleUserMessage, handleCancelGeneration, isConversing }
}
