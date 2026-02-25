import type Database from 'better-sqlite3'
import { initDb } from './db.js'
import { loadConfig } from './config.js'
import { MessageRouter } from './router.js'
import { TriggerLoop } from './trigger-loop.js'
import { logger } from './logger.js'

/**
 * Start the CueClaw daemon.
 * Initializes DB, channels, crash recovery, and trigger loop.
 */
export async function startDaemon(): Promise<void> {
  const config = loadConfig()
  const db = initDb()
  const cwd = process.cwd()

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
      logger.info('Telegram channel started')
    } catch (err) {
      logger.error({ err }, 'Failed to start Telegram channel')
    }
  }

  // Crash recovery
  await recoverRunningWorkflows(db, router)

  // Start trigger loop
  const maxConcurrent = 5
  const triggerLoop = new TriggerLoop(db, router, cwd, maxConcurrent)
  triggerLoop.start()
  router.start()

  logger.info('Daemon started')

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down daemon...')
    triggerLoop.stop()
    router.stop()
    db.close()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
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
