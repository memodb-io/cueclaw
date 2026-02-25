import { Bot, InlineKeyboard } from 'grammy'
import type { Channel, Workflow, OnInboundMessage, NewMessage } from '../types.js'
import { logger } from '../logger.js'

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096

/**
 * Telegram Channel implementation using grammy.
 * Supports inline keyboard buttons for plan confirmation.
 */
export class TelegramChannel implements Channel {
  readonly name = 'telegram'
  private bot: Bot
  private connected = false
  private onInbound: OnInboundMessage | null = null
  private callbackHandler: ((workflowId: string, action: string, chatId: string) => void) | null = null

  constructor(
    token: string,
    private allowedUsers: string[] = [],
    onInbound?: OnInboundMessage,
  ) {
    this.bot = new Bot(token)
    this.onInbound = onInbound ?? null
  }

  /** Set a handler for inline keyboard callback actions (confirm/modify/cancel) */
  onCallback(handler: (workflowId: string, action: string, chatId: string) => void): void {
    this.callbackHandler = handler
  }

  async connect(): Promise<void> {
    this.bot.on('message:text', (ctx) => {
      const jid = String(ctx.chat.id)
      if (!this.isAllowed(jid)) return

      const newMsg: NewMessage = {
        text: ctx.message.text,
        sender: String(ctx.from?.id ?? 'unknown'),
      }

      this.onInbound?.(jid, newMsg)
    })

    this.bot.on('callback_query:data', async (ctx) => {
      await ctx.answerCallbackQuery()

      const data = ctx.callbackQuery.data
      const chatId = String(ctx.callbackQuery.message?.chat.id ?? '')
      const [action, workflowId] = data.split(':')

      if (action && workflowId && chatId) {
        this.callbackHandler?.(workflowId, action, chatId)
      }
    })

    this.bot.catch((err) => {
      logger.error({ err: err.error }, 'Telegram bot error')
    })

    await this.bot.start()
    this.connected = true
    logger.info('Telegram bot connected')
  }

  async disconnect(): Promise<void> {
    await this.bot.stop()
    this.connected = false
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const chunks = chunkMessage(text)
    for (const chunk of chunks) {
      await this.bot.api.sendMessage(Number(jid), chunk)
    }
  }

  async sendConfirmation(jid: string, workflow: Workflow): Promise<void> {
    const steps = workflow.steps.map((s, i) => `${i + 1}. ${s.description}`).join('\n')
    const trigger = workflow.trigger.type === 'manual'
      ? 'manual'
      : workflow.trigger.type === 'cron'
        ? `cron (${workflow.trigger.expression})`
        : `poll (${workflow.trigger.interval_seconds}s)`

    const text = [
      `Workflow: ${escapeMdV2(workflow.name)}`,
      `Trigger: ${escapeMdV2(trigger)}`,
      '',
      '*Steps:*',
      escapeMdV2(steps),
    ].join('\n')

    const keyboard = new InlineKeyboard()
      .text('Confirm', `confirm:${workflow.id}`)
      .text('Modify', `modify:${workflow.id}`)
      .text('Cancel', `cancel:${workflow.id}`)

    await this.bot.api.sendMessage(Number(jid), text, {
      reply_markup: keyboard,
      parse_mode: 'MarkdownV2',
    })
  }

  isConnected(): boolean {
    return this.connected
  }

  ownsJid(jid: string): boolean {
    return /^-?\d+$/.test(jid)
  }

  async setTyping(jid: string, _isTyping: boolean): Promise<void> {
    try {
      await this.bot.api.sendChatAction(Number(jid), 'typing')
    } catch {
      // Best-effort typing indicator
    }
  }

  private isAllowed(jid: string): boolean {
    if (this.allowedUsers.length === 0) return true
    return this.allowedUsers.includes(jid)
  }
}

/** Escape all MarkdownV2 special characters for Telegram API */
function escapeMdV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&')
}

/** Split long messages into chunks that fit Telegram's limit */
function chunkMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_MESSAGE_LENGTH) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
      chunks.push(remaining)
      break
    }

    // Try to break at newline
    let breakAt = remaining.lastIndexOf('\n', TELEGRAM_MAX_MESSAGE_LENGTH)
    if (breakAt === -1 || breakAt < TELEGRAM_MAX_MESSAGE_LENGTH / 2) {
      // Fall back to space
      breakAt = remaining.lastIndexOf(' ', TELEGRAM_MAX_MESSAGE_LENGTH)
    }
    if (breakAt === -1) {
      breakAt = TELEGRAM_MAX_MESSAGE_LENGTH
    }

    chunks.push(remaining.slice(0, breakAt))
    remaining = remaining.slice(breakAt).trimStart()
  }

  return chunks
}

export { escapeMdV2, chunkMessage }
