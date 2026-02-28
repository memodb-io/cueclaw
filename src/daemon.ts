import type Database from 'better-sqlite3'
import { writeFileSync, unlinkSync, readFileSync, openSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { initDb } from './db.js'
import { loadConfig, cueclawHome } from './config.js'
import { MessageRouter } from './router.js'
import { TriggerLoop } from './trigger-loop.js'
import { cleanupStaleSessions } from './session.js'
import { logger } from './logger.js'

/** Path to the daemon PID file */
export function daemonPidPath(): string {
  return join(cueclawHome(), 'daemon.pid')
}

/** Write daemon PID file */
export function writePidFile(pid: number): void {
  writeFileSync(daemonPidPath(), String(pid), 'utf-8')
}

/** Remove daemon PID file */
export function removePidFile(): void {
  try { unlinkSync(daemonPidPath()) } catch { /* may not exist */ }
}

/** Read daemon PID from file, or null if not found */
export function readPidFile(): number | null {
  try {
    const content = readFileSync(daemonPidPath(), 'utf-8').trim()
    const pid = Number(content)
    return Number.isFinite(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

/** Check if a process with the given PID is alive */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Check if an external daemon is running (via PID file or system service) */
export function isDaemonRunning(): boolean {
  const pid = readPidFile()
  if (pid && isProcessAlive(pid)) return true
  return false
}

/**
 * Spawn a detached daemon process in the background.
 * Passes process.execArgv so tsx/loader flags carry over (dev mode).
 * Redirects output to daemon.log for debuggability.
 * Returns the child PID, or null on failure.
 */
export function spawnDaemonProcess(): number | null {
  const logDir = join(cueclawHome(), 'logs')
  mkdirSync(logDir, { recursive: true })
  const logPath = join(logDir, 'daemon.log')
  const logFd = openSync(logPath, 'a')

  const child = spawn(
    process.execPath,
    [...process.execArgv, process.argv[1]!, 'daemon', 'start', '--foreground'],
    {
      detached: true,
      stdio: ['ignore', logFd, logFd],
    },
  )
  child.unref()

  if (child.pid) {
    writePidFile(child.pid)
    return child.pid
  }
  return null
}

/**
 * Start the CueClaw daemon.
 * Initializes DB, channels, crash recovery, and trigger loop.
 */
export async function startDaemon(): Promise<void> {
  const config = loadConfig()
  const db = initDb()
  const cwd = process.cwd()
  logger.debug({ cwd }, 'Daemon initializing')

  const router = new MessageRouter(db, config, cwd)

  // Start enabled channels
  if (config.whatsapp?.enabled) {
    try {
      const { WhatsAppChannel } = await import('./channels/whatsapp.js')
      const wa = new WhatsAppChannel(
        config.whatsapp.auth_dir ?? `${process.env['HOME']}/.cueclaw/auth/whatsapp`,
        config.whatsapp.allowed_jids ?? [],
        (jid, msg) => router.handleInbound('whatsapp', jid, msg),
      )
      router.registerChannel(wa)
      await wa.connect()
      logger.info('WhatsApp channel started')
    } catch (err) {
      logger.error({ err }, 'Failed to start WhatsApp channel')
    }
  }

  if (config.telegram?.enabled) {
    try {
      const { TelegramChannel } = await import('./channels/telegram.js')
      const tg = new TelegramChannel(
        config.telegram.token!,
        config.telegram.allowed_users ?? [],
        (jid, msg) => router.handleInbound('telegram', jid, msg),
      )
      router.registerChannel(tg)
      await tg.connect()
      tg.onCallback((wfId, action, chatId) => router.handleCallbackAction('telegram', chatId, wfId, action))
      logger.info('Telegram channel started')
    } catch (err) {
      logger.error({ err }, 'Failed to start Telegram channel')
    }
  }

  // Cleanup stale sessions on startup
  const cleaned = cleanupStaleSessions(db)
  if (cleaned > 0) logger.info({ cleaned }, 'Cleaned up stale sessions')

  // Crash recovery
  await recoverRunningWorkflows(db, router)

  // Start trigger loop
  logger.debug('Starting trigger loop and router')
  const maxConcurrent = 5
  const triggerLoop = new TriggerLoop(db, router, cwd, maxConcurrent)
  triggerLoop.start()
  router.start()

  logger.info('Daemon started')

  // Write PID file for daemon management
  writePidFile(process.pid)

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down daemon...')
    removePidFile()
    triggerLoop.stop()
    router.stop()
    await router.disconnectAll()
    db.close()
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}

/**
 * Recover from interrupted runs on daemon restart.
 * Marks running workflow_runs as failed and notifies users.
 */
async function recoverRunningWorkflows(
  db: Database.Database,
  router: MessageRouter,
): Promise<void> {
  const interruptedRuns = db.prepare(
    "SELECT id, workflow_id FROM workflow_runs WHERE status = 'running'"
  ).all() as Array<{ id: string; workflow_id: string }>

  if (interruptedRuns.length === 0) return

  logger.warn({ count: interruptedRuns.length }, 'Recovering interrupted workflow runs')

  for (const run of interruptedRuns) {
    logger.warn({ runId: run.id, workflowId: run.workflow_id }, 'Recovering interrupted run')
    db.prepare(
      "UPDATE workflow_runs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?"
    ).run('Daemon restarted during execution', new Date().toISOString(), run.id)

    // Also mark running step_runs as failed
    db.prepare(
      "UPDATE step_runs SET status = 'failed', error = ? WHERE run_id = ? AND status = 'running'"
    ).run('Daemon restarted during execution', run.id)

    router.broadcastNotification(
      `Workflow ${run.workflow_id} was interrupted by daemon restart (run ${run.id})`
    )
  }
}
