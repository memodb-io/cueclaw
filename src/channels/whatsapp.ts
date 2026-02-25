import type { Channel, Workflow, OnInboundMessage, NewMessage } from '../types.js'
import { logger } from '../logger.js'

/**
 * WhatsApp Channel implementation using Baileys.
 * Uses multi-file auth state for persistence across restarts.
 */
export class WhatsAppChannel implements Channel {
  readonly name = 'whatsapp'
  private sock: any = null
  private connected = false
  private onInbound: OnInboundMessage | null = null

  constructor(
    private authDir: string,
    private allowedJids: string[] = [],
    onInbound?: OnInboundMessage,
  ) {
    this.onInbound = onInbound ?? null
  }

  async connect(): Promise<void> {
    const baileys = await import('@whiskeysockets/baileys')
    const makeWASocket = baileys.default
    const { useMultiFileAuthState } = baileys

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir)

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
    })

    this.sock.ev.on('creds.update', saveCreds)

    this.sock.ev.on('connection.update', (update: any) => {
      if (update.connection === 'open') {
        this.connected = true
        logger.info('WhatsApp connected')
      } else if (update.connection === 'close') {
        this.connected = false
        logger.warn('WhatsApp disconnected')
        // Reconnection is handled by Baileys internally
      }
    })

    this.sock.ev.on('messages.upsert', ({ messages }: any) => {
      for (const msg of messages) {
        if (msg.key.fromMe || !msg.message) continue

        const jid = msg.key.remoteJid
        if (!jid) continue

        // Allowlist check
        if (this.allowedJids.length > 0 && !this.allowedJids.includes(jid)) continue

        const text = msg.message.conversation
          || msg.message.extendedTextMessage?.text
          || ''

        if (!text) continue

        const newMsg: NewMessage = {
          text,
          sender: msg.key.participant || jid,
        }

        this.onInbound?.(jid, newMsg)
      }
    })
  }

  async disconnect(): Promise<void> {
    if (this.sock) {
      this.sock.end()
      this.sock = null
      this.connected = false
    }
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp not connected')
    await this.sock.sendMessage(jid, { text })
  }

  async sendConfirmation(jid: string, workflow: Workflow): Promise<void> {
    const steps = workflow.steps.map((s, i) => `${i + 1}. ${s.description}`).join('\n')
    const trigger = workflow.trigger.type === 'manual'
      ? 'manual'
      : workflow.trigger.type === 'cron'
        ? `cron (${workflow.trigger.expression})`
        : `poll (${workflow.trigger.interval_seconds}s)`

    const text = [
      `Workflow: ${workflow.name}`,
      `Trigger: ${trigger}`,
      '',
      'Steps:',
      steps,
      '',
      'Reply: 1=Confirm, 2=Modify, 3=Cancel',
    ].join('\n')

    await this.sendMessage(jid, text)
  }

  isConnected(): boolean {
    return this.connected
  }

  ownsJid(jid: string): boolean {
    return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@g.us')
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.sock) return
    try {
      await this.sock.sendPresenceUpdate(isTyping ? 'composing' : 'paused', jid)
    } catch {
      // Best-effort typing indicator
    }
  }
}
