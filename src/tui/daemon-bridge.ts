import type Database from 'better-sqlite3'
import type { CueclawConfig } from '../config.js'
import type { Channel } from '../types.js'
import { TriggerLoop } from '../trigger-loop.js'
import { MessageRouter } from '../router.js'
import { getServiceStatus } from '../service.js'
import { isDaemonRunning, spawnDaemonProcess, isProcessAlive, readPidFile, removePidFile } from '../daemon.js'
import { logger } from '../logger.js'

export interface DaemonBridge {
  triggerLoop: TriggerLoop | null
  router: MessageRouter | null
  botChannels: Channel[]
  botConnectResult: BotConnectResult | null
  isExternal: boolean
}

export interface InitDaemonBridgeOptions {
  skipBots?: boolean
}

const externalBridge: DaemonBridge = {
  triggerLoop: null,
  router: null,
  botChannels: [],
  botConnectResult: null,
  isExternal: true,
}

/** Wait for daemon to be alive, checking every 200ms up to maxWait */
function waitForDaemon(pid: number, maxWaitMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const start = Date.now()
    const check = () => {
      if (isProcessAlive(pid)) return resolve(true)
      if (Date.now() - start > maxWaitMs) return resolve(false)
      setTimeout(check, 200)
    }
    check()
  })
}

/**
 * Initialize the daemon bridge.
 * If a daemon (system service or PID-based) is already running, TUI operates as frontend only.
 * Otherwise, spawns a background daemon automatically and operates as frontend.
 * Falls back to in-process mode if daemon spawn fails.
 */
export async function initDaemonBridge(
  db: Database.Database,
  config: CueclawConfig,
  cwd: string,
  options?: InitDaemonBridgeOptions,
): Promise<DaemonBridge> {
  const serviceRunning = getServiceStatus() === 'running'
  const pidDaemonRunning = isDaemonRunning()

  if (serviceRunning || pidDaemonRunning) {
    logger.info({ via: serviceRunning ? 'service' : 'pid' }, 'External daemon detected, TUI will operate as frontend only')
    return externalBridge
  }

  // No daemon running — spawn one in background
  const pid = spawnDaemonProcess()
  if (pid) {
    const alive = await waitForDaemon(pid, 2000)
    if (alive) {
      logger.info({ pid }, 'Background daemon started, TUI will operate as frontend only')
      return externalBridge
    }
    logger.warn({ pid }, 'Spawned daemon process died, falling back to in-process mode')
  } else {
    logger.warn('Failed to spawn background daemon, falling back to in-process mode')
  }

  // Fallback: start in-process daemon components
  const router = new MessageRouter(db, config, cwd)
  const botChannels: Channel[] = []
  let botConnectResult: BotConnectResult | null = null

  if (!options?.skipBots) {
    botConnectResult = await connectBotChannels(config, router, botChannels)
  }

  const triggerLoop = new TriggerLoop(db, router, cwd, 5)
  triggerLoop.start()
  router.start()

  logger.info('In-process daemon bridge started (fallback)')

  return {
    triggerLoop,
    router,
    botChannels,
    botConnectResult,
    isExternal: false,
  }
}

/**
 * Start bot channels on an existing bridge.
 * Call this after user confirms they want to run bots.
 */
export async function startBotChannels(
  bridge: DaemonBridge,
  config: CueclawConfig,
): Promise<void> {
  if (bridge.isExternal || !bridge.router) return
  await connectBotChannels(config, bridge.router, bridge.botChannels)
}

export interface BotConnectResult {
  connected: string[]
  failed: string[]
}

async function connectBotChannels(
  config: CueclawConfig,
  router: MessageRouter,
  botChannels: Channel[],
): Promise<BotConnectResult> {
  const connected: string[] = []
  const failed: string[] = []

  if (config.telegram?.enabled && config.telegram.token) {
    try {
      const { TelegramChannel } = await import('../channels/telegram.js')
      const tg = new TelegramChannel(
        config.telegram.token,
        config.telegram.allowed_users ?? [],
        (jid, msg) => router.handleInbound('telegram', jid, msg),
      )
      router.registerChannel(tg)
      await tg.connect()
      tg.onCallback((wfId, action, chatId) => router.handleCallbackAction('telegram', chatId, wfId, action))
      botChannels.push(tg)
      connected.push('Telegram')
      logger.info('Telegram channel started (in-process)')
    } catch (err) {
      failed.push('Telegram')
      logger.error({ err }, 'Failed to start Telegram channel')
    }
  }

  if (config.whatsapp?.enabled) {
    try {
      const { WhatsAppChannel } = await import('../channels/whatsapp.js')
      const wa = new WhatsAppChannel(
        config.whatsapp.auth_dir ?? `${process.env['HOME']}/.cueclaw/auth/whatsapp`,
        config.whatsapp.allowed_jids ?? [],
        (jid, msg) => router.handleInbound('whatsapp', jid, msg),
      )
      router.registerChannel(wa)
      await wa.connect()
      botChannels.push(wa)
      connected.push('WhatsApp')
      logger.info('WhatsApp channel started (in-process)')
    } catch (err) {
      failed.push('WhatsApp')
      logger.error({ err }, 'Failed to start WhatsApp channel')
    }
  }

  return { connected, failed }
}

/**
 * Shut down the daemon bridge, stopping trigger loop and bot channels.
 */
export async function stopDaemonBridge(bridge: DaemonBridge): Promise<void> {
  if (bridge.isExternal) return

  bridge.triggerLoop?.stop()
  bridge.router?.stop()

  for (const channel of bridge.botChannels) {
    try {
      await channel.disconnect()
    } catch (err) {
      logger.error({ err, channel: channel.name }, 'Failed to disconnect channel')
    }
  }

  logger.info('Daemon bridge stopped')
}

/**
 * Stop the external daemon process via PID file.
 */
export function stopExternalDaemon(): void {
  const pid = readPidFile()
  if (pid && isProcessAlive(pid)) {
    process.kill(pid, 'SIGTERM')
    removePidFile()
    logger.info({ pid }, 'Stopped external daemon')
  }
}
