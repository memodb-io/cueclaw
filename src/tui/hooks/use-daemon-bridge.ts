import { useState, useEffect, useRef } from 'react'
import { initDaemonBridge, stopDaemonBridge, type DaemonBridge } from '../daemon-bridge.js'
import { logger } from '../../logger.js'
import type { CueclawConfig } from '../../config.js'
import type Database from 'better-sqlite3'
import type { AppAction } from '../app-provider.js'

type Dispatch = (action: AppAction) => void

export function useDaemonBridge(
  config: CueclawConfig | null,
  db: Database.Database,
  cwd: string,
  dispatch: Dispatch,
) {
  const bridgeRef = useRef<DaemonBridge | null>(null)
  const [daemonStatus, setDaemonStatus] = useState<'starting' | 'running' | 'external' | 'none'>('none')

  const hasConfiguredBots = !!(
    (config?.telegram?.enabled && config?.telegram?.token) ||
    config?.whatsapp?.enabled
  )

  useEffect(() => {
    if (!config) return

    let cancelled = false
    setDaemonStatus('starting')
    dispatch({ type: 'ADD_MESSAGE', message: { type: 'system', text: 'Starting daemon...' } })

    initDaemonBridge(db, config, cwd, { skipBots: !hasConfiguredBots }).then(bridge => {
      if (cancelled) {
        stopDaemonBridge(bridge).catch(err => {
          logger.error({ err }, 'Failed to stop daemon bridge after cancellation')
        })
        return
      }
      bridgeRef.current = bridge
      setDaemonStatus(bridge.isExternal ? 'external' : 'running')
      dispatch({
        type: 'ADD_MESSAGE',
        message: {
          type: 'system',
          text: bridge.isExternal ? 'Background daemon running.' : 'Daemon started (in-process).',
        },
      })

      // Report bot connection results for in-process fallback
      if (!bridge.isExternal && bridge.botConnectResult) {
        const { connected, failed } = bridge.botConnectResult
        if (connected.length > 0) {
          dispatch({
            type: 'ADD_MESSAGE',
            message: { type: 'system', text: `${connected.join(', ')} bot${connected.length > 1 ? 's' : ''} connected.` },
          })
        }
        if (failed.length > 0) {
          dispatch({
            type: 'ADD_MESSAGE',
            message: { type: 'error', text: `Failed to connect: ${failed.join(', ')}. Check logs for details.` },
          })
        }
      }
    }).catch(err => {
      logger.error({ err }, 'Failed to start daemon bridge')
      setDaemonStatus('none')
      dispatch({ type: 'ADD_MESSAGE', message: { type: 'system', text: 'Failed to start daemon.' } })
    })

    return () => {
      cancelled = true
      if (bridgeRef.current) {
        stopDaemonBridge(bridgeRef.current).catch(err => {
          logger.error({ err }, 'Failed to stop daemon bridge during cleanup')
        })
        bridgeRef.current = null
      }
    }
  }, [config, db, cwd])

  return { bridgeRef, daemonStatus }
}
