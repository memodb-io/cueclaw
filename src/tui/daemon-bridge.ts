import type Database from 'better-sqlite3'
import type { CueclawConfig } from '../config.js'
import type { Channel } from '../types.js'
import { TriggerLoop } from '../trigger-loop.js'
import { MessageRouter } from '../router.js'
import { getServiceStatus } from '../service.js'
import { logger } from '../logger.js'

export interface DaemonBridge {
  triggerLoop: TriggerLoop | null
  router: MessageRouter | null
  botChannels: Channel[]
  isExternal: boolean
}

export interface InitDaemonBridgeOptions {
  skipBots?: boolean
}

/**
 * Initialize the daemon bridge.
 * If a system service daemon is running, returns a bridge with isExternal=true.
 * Otherwise, starts TriggerLoop (and optionally bot channels) in-process.
 */
export async function initDaemonBridge(
  db: Database.Database,
  config: CueclawConfig,
  cwd: string,
  options?: InitDaemonBridgeOptions,
): Promise<DaemonBridge> {
  const status = getServiceStatus()

  if (status === 'running') {
    logger.info('External daemon detected, TUI will operate as frontend only')
    return {
      triggerLoop: null,
      router: null,
      botChannels: [],
      isExternal: true,
    }
  }

  // Start in-process daemon components
  const router = new MessageRouter(db, config, cwd)
  const botChannels: Channel[] = []

  if (!options?.skipBots) {
    await connectBotChannels(config, router, botChannels)
  }

  // Start trigger loop
  const triggerLoop = new TriggerLoop(db, router, cwd, 5)
  triggerLoop.start()
  router.start()

  logger.info('In-process daemon bridge started')

  return {
    triggerLoop,
    router,
    botChannels,
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

async function connectBotChannels(
  config: CueclawConfig,
  router: MessageRouter,
  botChannels: Channel[],
): Promise<void> {
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
      logger.info('Telegram channel started (in-process)')
    } catch (err) {
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
      logger.info('WhatsApp channel started (in-process)')
    } catch (err) {
      logger.error({ err }, 'Failed to start WhatsApp channel')
    }
  }
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
