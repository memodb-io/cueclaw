import type Database from 'better-sqlite3'
import type { Channel, NewMessage, Workflow } from './types.js'
import { generatePlan, modifyPlan, confirmPlan, rejectPlan } from './planner.js'
import { executeWorkflow } from './executor.js'
import { createAnthropicClient } from './anthropic-client.js'
import type { CueclawConfig } from './config.js'
import { listWorkflows, getWorkflow, updateWorkflowPhase, insertWorkflow } from './db.js'
import { logger } from './logger.js'

const CONFIRMATION_TIMEOUT = 10 * 60_000
const RATE_LIMIT_WINDOW = 60_000
const RATE_LIMIT_MAX = 10
const CLEANUP_INTERVAL = 5 * 60_000

interface PendingConfirmation {
  workflowId: string
  workflow: Workflow
  expiresAt: number
}

export class MessageRouter {
  private channels: Map<string, Channel> = new Map()
  private pendingConfirmations: Map<string, PendingConfirmation> = new Map()
  private messageTimestamps: Map<string, number[]> = new Map()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private db: Database.Database,
    private config: CueclawConfig,
    private cwd: string,
  ) {}

  registerChannel(channel: Channel): void {
    this.channels.set(channel.name, channel)
    logger.debug({ channel: channel.name }, 'Channel registered')
  }

  start(): void {
    this.cleanupTimer = setInterval(() => this.cleanupRateLimits(), CLEANUP_INTERVAL)
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /** Disconnect all registered channels */
  async disconnectAll(): Promise<void> {
    await Promise.allSettled(
      [...this.channels.values()].map(c => c.disconnect())
    )
  }

  /** Broadcast a notification to all connected channels (used by MCP handler) */
  broadcastNotification(message: string): void {
    for (const channel of this.channels.values()) {
      if (channel.isConnected()) {
        channel.sendMessage('broadcast', message).catch((err) => {
          logger.error({ err, channel: channel.name }, 'Failed to broadcast notification')
        })
      }
    }
  }

  async handleInbound(channelName: string, chatJid: string, message: NewMessage): Promise<void> {
    const channel = this.channels.get(channelName)
    if (!channel) {
      logger.warn({ channelName }, 'Message from unknown channel')
      return
    }

    const text = typeof message === 'string' ? message : message.text
    logger.debug({ channelName, chatJid }, 'Inbound message received')

    // Rate limiting
    if (this.isRateLimited(chatJid)) {
      logger.warn({ chatJid, channelName }, 'Rate limit exceeded')
      await channel.sendMessage(chatJid, 'Rate limited, please wait before sending more messages.')
      return
    }

    if (text.startsWith('/') || text.startsWith('!')) {
      await this.handleCommand(channel, chatJid, text)
    } else if (this.pendingConfirmations.has(chatJid)) {
      const pending = this.pendingConfirmations.get(chatJid)!
      if (Date.now() > pending.expiresAt) {
        this.pendingConfirmations.delete(chatJid)
        await channel.sendMessage(chatJid, 'Your pending plan has expired. Send a new description to start over.')
      } else {
        await this.handleConfirmation(channel, chatJid, text)
      }
    } else {
      await this.classifyAndRoute(channel, chatJid, text)
    }
  }

  private async handleCommand(channel: Channel, chatJid: string, text: string): Promise<void> {
    const parts = text.slice(1).split(/\s+/)
    const command = parts[0]?.toLowerCase()
    const args = parts.slice(1).join(' ')

    switch (command) {
      case 'new':
        if (args) {
          await this.handleNewWorkflow(channel, chatJid, args)
        } else {
          await channel.sendMessage(chatJid, 'Send a workflow description to create a new workflow.')
        }
        break

      case 'list': {
        const workflows = listWorkflows(this.db)
        if (workflows.length === 0) {
          await channel.sendMessage(chatJid, 'No workflows found.')
        } else {
          const lines = workflows.map(wf =>
            `${wf.id.slice(0, 8)}  ${wf.phase.padEnd(12)}  ${wf.name}`
          )
          await channel.sendMessage(chatJid, `Workflows:\n${lines.join('\n')}`)
        }
        break
      }

      case 'status': {
        if (!args) {
          await channel.sendMessage(chatJid, 'Usage: /status <workflow-id>')
          break
        }
        const wf = getWorkflow(this.db, args)
        if (!wf) {
          await channel.sendMessage(chatJid, `Workflow not found: ${args}`)
        } else {
          const steps = wf.steps.map((s, i) => `${i + 1}. ${s.description}`).join('\n')
          await channel.sendMessage(chatJid, `Workflow: ${wf.name}\nPhase: ${wf.phase}\n\nSteps:\n${steps}`)
        }
        break
      }

      case 'cancel': {
        if (!args) {
          await channel.sendMessage(chatJid, 'Usage: /cancel <workflow-id>')
          break
        }
        const wf = getWorkflow(this.db, args)
        if (!wf) {
          await channel.sendMessage(chatJid, `Workflow not found: ${args}`)
        } else {
          const rejected = rejectPlan(wf)
          updateWorkflowPhase(this.db, wf.id, rejected.phase)
          await channel.sendMessage(chatJid, `Workflow cancelled: ${wf.name}`)
        }
        break
      }

      case 'help':
        await channel.sendMessage(chatJid, [
          'Commands:',
          '/new <description> — Create a new workflow',
          '/list — List all workflows',
          '/status <id> — View workflow status',
          '/cancel <id> — Cancel a workflow',
          '/help — Show this help',
        ].join('\n'))
        break

      default:
        await channel.sendMessage(chatJid, `Unknown command: ${command}. Type /help for available commands.`)
    }
  }

  async handleCallbackAction(channelName: string, chatId: string, _workflowId: string, action: string): Promise<void> {
    const actionMap: Record<string, string> = {
      confirm: 'yes',
      modify: 'modify',
      cancel: 'no',
    }
    const mappedText = actionMap[action] ?? action
    await this.handleInbound(channelName, chatId, { text: mappedText, sender: chatId })
  }

  private async classifyAndRoute(channel: Channel, chatJid: string, text: string): Promise<void> {
    try {
      const client = createAnthropicClient(this.config)
      const response = await client.messages.create({
        model: this.config.claude.planner.model,
        max_tokens: 512,
        system: 'You are a router for CueClaw, a workflow automation tool. Classify the user message and call the appropriate tool. Use create_workflow_request if the user wants to automate a task, set up a workflow, schedule something, or perform an action that requires multiple steps. Use chat_reply for greetings, questions about capabilities, casual conversation, or anything that is not a workflow request.',
        messages: [{ role: 'user', content: text }],
        tools: [
          {
            name: 'create_workflow_request',
            description: 'The user wants to create an automation workflow',
            input_schema: { type: 'object' as const, properties: {} },
          },
          {
            name: 'chat_reply',
            description: 'Reply to casual conversation or questions',
            input_schema: {
              type: 'object' as const,
              properties: {
                message: { type: 'string', description: 'The reply to send to the user' },
              },
              required: ['message'],
            },
          },
        ],
        tool_choice: { type: 'any' },
      })

      const toolUse = response.content.find((b) => b.type === 'tool_use')
      if (toolUse && toolUse.type === 'tool_use' && toolUse.name === 'chat_reply') {
        const input = toolUse.input as { message?: string }
        await channel.sendMessage(chatJid, input.message ?? "I'm CueClaw, a workflow automation tool. Send me a task description and I'll create a plan for you!")
      } else {
        await this.handleNewWorkflow(channel, chatJid, text)
      }
    } catch (err) {
      logger.error({ err, chatJid }, 'Classification failed, falling back to workflow')
      await this.handleNewWorkflow(channel, chatJid, text)
    }
  }

  private async handleNewWorkflow(channel: Channel, chatJid: string, text: string): Promise<void> {
    await channel.sendMessage(chatJid, 'Generating execution plan...')
    channel.setTyping?.(chatJid, true)

    try {
      const workflow = await generatePlan(text, this.config)
      insertWorkflow(this.db, workflow)
      channel.setTyping?.(chatJid, false)

      this.pendingConfirmations.set(chatJid, {
        workflowId: workflow.id,
        workflow,
        expiresAt: Date.now() + CONFIRMATION_TIMEOUT,
      })

      await channel.sendConfirmation(chatJid, workflow)
    } catch (err) {
      channel.setTyping?.(chatJid, false)
      const msg = err instanceof Error ? err.message : String(err)
      await channel.sendMessage(chatJid, `Failed to generate plan: ${msg}`)
      logger.error({ err, chatJid }, 'Plan generation failed')
    }
  }

  private async handleConfirmation(channel: Channel, chatJid: string, text: string): Promise<void> {
    const pending = this.pendingConfirmations.get(chatJid)
    if (!pending) return

    const lower = text.toLowerCase().trim()

    if (['yes', 'y', 'confirm', '1'].includes(lower)) {
      this.pendingConfirmations.delete(chatJid)
      const confirmed = confirmPlan(pending.workflow)
      logger.info({ workflowId: confirmed.id, chatJid }, 'Workflow confirmed via channel')
      await channel.sendMessage(chatJid, `Workflow activated: ${confirmed.name} (${confirmed.id})`)

      channel.setTyping?.(chatJid, true)
      try {
        const result = await executeWorkflow({
          workflow: confirmed,
          triggerData: null,
          db: this.db,
          cwd: this.cwd,
          onProgress: async (stepId, msg) => {
            if (typeof msg === 'object' && msg?.type === 'step_complete') {
              await channel.sendMessage(chatJid, `Step completed: ${stepId}`)
            }
          },
        })
        channel.setTyping?.(chatJid, false)
        await channel.sendMessage(chatJid, `Workflow complete! Status: ${result.status}`)
      } catch (err) {
        channel.setTyping?.(chatJid, false)
        const msg = err instanceof Error ? err.message : String(err)
        await channel.sendMessage(chatJid, `Workflow failed: ${msg}`)
      }
    } else if (['no', 'n', 'cancel', '3'].includes(lower)) {
      this.pendingConfirmations.delete(chatJid)
      rejectPlan(pending.workflow)
      logger.info({ workflowId: pending.workflowId, chatJid }, 'Workflow rejected via channel')
      await channel.sendMessage(chatJid, 'Plan cancelled.')
    } else if (['modify', 'm', '2'].includes(lower)) {
      await channel.sendMessage(chatJid, 'Describe your modifications:')
      // Keep pending — next message will be treated as modification
    } else {
      // Treat as modification input
      this.pendingConfirmations.delete(chatJid)
      await channel.sendMessage(chatJid, 'Modifying plan...')
      channel.setTyping?.(chatJid, true)

      try {
        const modified = await modifyPlan(pending.workflow, text, this.config)
        logger.info({ workflowId: modified.id, chatJid }, 'Workflow modified via channel')
        insertWorkflow(this.db, modified)
        channel.setTyping?.(chatJid, false)

        this.pendingConfirmations.set(chatJid, {
          workflowId: modified.id,
          workflow: modified,
          expiresAt: Date.now() + CONFIRMATION_TIMEOUT,
        })

        await channel.sendConfirmation(chatJid, modified)
      } catch (err) {
        channel.setTyping?.(chatJid, false)
        const msg = err instanceof Error ? err.message : String(err)
        await channel.sendMessage(chatJid, `Modification failed: ${msg}`)
      }
    }
  }

  private isRateLimited(chatJid: string): boolean {
    const now = Date.now()
    const timestamps = this.messageTimestamps.get(chatJid) ?? []
    const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW)
    recent.push(now)
    this.messageTimestamps.set(chatJid, recent)
    return recent.length > RATE_LIMIT_MAX
  }

  private cleanupRateLimits(): void {
    const now = Date.now()
    for (const [jid, timestamps] of this.messageTimestamps) {
      const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW)
      if (recent.length === 0) {
        this.messageTimestamps.delete(jid)
      } else {
        this.messageTimestamps.set(jid, recent)
      }
    }
  }
}
