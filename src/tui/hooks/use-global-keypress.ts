import React, { useCallback } from 'react'
import { useKeypress, KeyPriority } from '../use-keypress.js'
import { keyBindings } from '../key-bindings.js'
import { listWorkflows } from '../../db.js'
import { handleExit } from './exit-helpers.js'
import type { DaemonBridge } from '../daemon-bridge.js'
import { WorkflowTable } from '../renderers.js'
import type Database from 'better-sqlite3'
import type { View } from '../ui-state-context.js'

interface UseGlobalKeypressOptions {
  isExecuting: boolean
  bridgeRef: React.RefObject<DaemonBridge | null>
  abortMapRef: React.RefObject<Map<string, AbortController>>
  db: Database.Database
  view: View
  exit: () => void
  showDialog: (dialog: any) => void
  dismissDialog: () => void
  dispatch: (action: any) => void
}

export function useGlobalKeypress({
  isExecuting,
  bridgeRef,
  abortMapRef,
  db,
  view,
  exit,
  showDialog,
  dismissDialog,
  dispatch,
}: UseGlobalKeypressOptions) {
  useKeypress('global-ctrl-c', KeyPriority.High, useCallback((input, key) => {
    if (keyBindings.ctrlC(input, key)) {
      // Abort any running workflow executions
      for (const controller of abortMapRef.current!.values()) {
        controller.abort()
      }

      handleExit({ bridgeRef, exit, showDialog, dismissDialog, isExecuting })
      return true
    }
    return false
  }, [isExecuting, exit, showDialog, dismissDialog]))

  useKeypress('global-ctrl-d', KeyPriority.Normal, useCallback((input, key) => {
    if (keyBindings.ctrlD(input, key)) {
      const workflows = listWorkflows(db)
      dispatch({
        type: 'ADD_MESSAGE',
        message: {
          type: 'assistant-jsx',
          content: React.createElement(WorkflowTable, { workflows }),
        },
      })
      return true
    }
    return false
  }, [db]), view !== 'onboarding')
}
