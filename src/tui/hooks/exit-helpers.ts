import React from 'react'
import { stopDaemonBridge, stopExternalDaemon, type DaemonBridge } from '../daemon-bridge.js'
import { isDaemonRunning } from '../../daemon.js'
import type { Dialog } from '../dialog-manager.js'

let sessionStartTime: number | null = null

/** Record the session start time (call once on mount) */
export function markSessionStart(): void {
  sessionStartTime = Date.now()
}

/** Format a duration in ms to a human-readable string like "2m 15s" */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

/** Print farewell message with session duration */
function printFarewell(): void {
  if (sessionStartTime !== null) {
    const duration = formatDuration(Date.now() - sessionStartTime)
    process.stdout.write(`\nGoodbye! Session: ${duration}\n`)
  }
}

/** Stop in-process bridge if any, then exit */
export function stopBridgeAndExit(
  bridgeRef: React.RefObject<DaemonBridge | null>,
  exit: () => void,
): void {
  const bridge = bridgeRef.current
  if (bridge && !bridge.isExternal) {
    stopDaemonBridge(bridge).finally(() => { printFarewell(); exit(); process.exit(0) })
  } else {
    printFarewell()
    exit()
    process.exit(0)
  }
}

/** Show exit dialog if daemon is running, otherwise exit directly */
export function handleExit(options: {
  bridgeRef: React.RefObject<DaemonBridge | null>
  exit: () => void
  showDialog: (dialog: Dialog) => void
  dismissDialog: () => void
  isExecuting?: boolean
}): void {
  const { bridgeRef, exit, showDialog, dismissDialog, isExecuting } = options
  const daemonRunning = isDaemonRunning()

  if (daemonRunning) {
    showDialog({
      title: 'Exit CueClaw',
      message: isExecuting
        ? 'A workflow is running and will be cancelled. A background daemon is also running.'
        : 'A background daemon is running with your bot channels.',
      actions: [
        { key: 'k', label: 'Keep daemon running', handler: () => {
          dismissDialog()
          stopBridgeAndExit(bridgeRef, exit)
        } },
        { key: 's', label: 'Stop daemon & exit', handler: () => {
          dismissDialog()
          stopExternalDaemon()
          stopBridgeAndExit(bridgeRef, exit)
        } },
      ],
    })
  } else {
    stopBridgeAndExit(bridgeRef, exit)
  }
}
