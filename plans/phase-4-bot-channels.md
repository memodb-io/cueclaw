# Phase 4: Bot Channels

> **Goal:** Implement WhatsApp and Telegram channels so users can create, confirm, and monitor workflows from messaging apps — with the exact same capabilities as the TUI.
>
> **Prerequisites:** Phase 0 (scaffolding) + Phase 1 (Planner, Executor)
>
> **Note:** Phase 4 has no dependency on Phase 3 (TUI) — they can be developed in parallel. Both implement the Channel interface and independently connect to the Planner/Executor.

---

## What Gets Built

By the end of Phase 4, you can:
1. Send a natural language workflow description via WhatsApp or Telegram
2. See the generated plan with inline confirm/modify/cancel buttons
3. Receive execution progress updates and completion notifications
4. Use bot commands (`/new`, `/list`, `/status`, `/cancel`) for workflow management

---

## What Already Exists (from Phase 0–1)

- `Channel` interface definition (including `sendConfirmation`) in `types.ts` (Phase 0)
- Planner and Executor ready to accept input from any Channel (Phase 1)
- Config loading for bot tokens and auth paths (Phase 0)

The Bot Channels plug into the same `OnInboundMessage → Core → Channel.sendMessage` message flow.

---

## Architecture

```
WhatsApp (Baileys) / Telegram (grammy)
     │
     ▼
Channel interface implementation
     │ OnInboundMessage callback
     ▼
CueClaw Core (message routing → Planner/Executor)
     │ sendMessage callback
     ▼
Channel.sendMessage() → Platform API
```

All Bots run as Channel instances within the single CueClaw daemon process — not as separate processes.

**Convention:** `OnInboundMessage` is provided at construction time (constructor parameter), not via an interface method. Each Channel implementation accepts it in its constructor and calls it when new messages arrive. See `docs/types.md` Channel interface for details.

---

## Tasks

### 4.1 Message Router (`src/router.ts`)

- [x] Central router that receives `OnInboundMessage` from any Channel
- [x] Routes to appropriate handler: new workflow creation, plan confirmation, workflow management
- [x] Formats outbound messages for the originating Channel
- [x] Handles concurrent messages from different channels for the same workflow
- [x] Message queue per chat to avoid interleaving responses

```typescript
const CONFIRMATION_TIMEOUT = 10 * 60_000  // 10 minutes default

interface PendingConfirmation {
  workflowId: string
  expiresAt: number
}

export class MessageRouter {
  private channels: Map<string, Channel> = new Map()
  private pendingConfirmations: Map<string, PendingConfirmation> = new Map()  // keyed by chatJid

  registerChannel(channel: Channel): void {
    this.channels.set(channel.name, channel)
  }

  /** Called after plan is generated and sent to user */
  setPendingConfirmation(chatJid: string, workflowId: string): void {
    this.pendingConfirmations.set(chatJid, {
      workflowId,
      expiresAt: Date.now() + CONFIRMATION_TIMEOUT,
    })
  }

  /** Check if a chat has a pending confirmation that hasn't expired */
  private hasPendingConfirmation(chatJid: string): boolean {
    const pending = this.pendingConfirmations.get(chatJid)
    if (!pending) return false
    if (Date.now() > pending.expiresAt) {
      this.pendingConfirmations.delete(chatJid)
      return false
    }
    return true
  }

  /** Clear pending confirmation (on confirm, cancel, or timeout) */
  private clearPendingConfirmation(chatJid: string): void {
    this.pendingConfirmations.delete(chatJid)
  }

  async handleInbound(
    channelName: string,
    chatJid: string,
    message: NewMessage
  ): Promise<void> {
    const channel = this.channels.get(channelName)!

    if (message.text.startsWith('/') || message.text.startsWith('!')) {
      await this.handleCommand(channel, chatJid, message)
    } else if (this.hasPendingConfirmation(chatJid)) {
      await this.handleConfirmation(channel, chatJid, message)
      // clearPendingConfirmation called inside handleConfirmation on confirm/cancel
    } else {
      await this.handleNewWorkflow(channel, chatJid, message)
    }
  }
}
```

### 4.2 WhatsApp Channel (`src/channels/whatsapp.ts`)

- [x] Initialize Baileys (`@whiskeysockets/baileys`) in polling mode
- [x] QR code authentication flow — display QR in terminal during setup
- [x] Persist auth state to `~/.cueclaw/auth/whatsapp/` (survives restarts)
- [x] Implement `Channel` interface: `connect()`, `sendMessage()`, `disconnect()`, etc.
- [x] `OnInboundMessage` callback on new message events
- [x] Handle both private chats and groups
- [x] ~~Outbound message queue with rate limiting~~ — NOT IMPLEMENTED (rate limiting handled at MessageRouter level, not per-channel)
- [ ] Group metadata sync with 24h cache — NOT IMPLEMENTED
- [x] `setTyping()` — show typing indicator while agent executes
- [ ] Reconnection logic with exponential backoff — NOT IMPLEMENTED

```typescript
import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys'

export class WhatsAppChannel implements Channel {
  name = 'whatsapp'
  private sock: ReturnType<typeof makeWASocket> | null = null

  async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir)
    this.sock = makeWASocket({ auth: state, printQRInTerminal: true })
    this.sock.ev.on('creds.update', saveCreds)
    this.sock.ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        if (!msg.key.fromMe && msg.message) {
          const jid = msg.key.remoteJid!
          // Allowlist check — only process messages from configured JIDs
          if (this.allowedJids.length > 0 && !this.allowedJids.includes(jid)) {
            continue
          }
          this.onInbound(jid, this.parseMessage(msg))
        }
      }
    })
  }

  async sendMessage(jid: string, text: string): Promise<string> {
    const sent = await this.sock!.sendMessage(jid, { text })
    return sent?.key?.id ?? ''
  }

  async editMessage(jid: string, messageId: string, text: string): Promise<void> {
    await this.sock!.sendMessage(jid, { text, edit: { remoteJid: jid, id: messageId, fromMe: true } })
  }

  // ... other Channel interface methods
}
```

### 4.3 Telegram Channel (`src/channels/telegram.ts`)

- [x] Initialize grammy bot with token from config
- [x] Polling mode only (`bot.start()` long polling) — webhook mode not implemented
- [x] Implement `Channel` interface
- [x] `OnInboundMessage` callback on new message events
- [x] **Inline Keyboard** for plan confirmation — buttons: Confirm, Modify, Cancel
- [x] Handle callback queries from inline keyboards
- [x] Message chunking for long messages (4096 character limit per message)
- [x] `setTyping()` via `sendChatAction('typing')`
- [x] User allowlist from config (`telegram.allowed_users`)
- [x] Command registration: `/new`, `/list`, `/status`, `/cancel`

```typescript
import { Bot, InlineKeyboard } from 'grammy'

export class TelegramChannel implements Channel {
  name = 'telegram'
  private bot: Bot

  async connect(): Promise<void> {
    this.bot = new Bot(this.token)

    this.bot.on('message:text', (ctx) => {
      const jid = String(ctx.chat.id)
      if (!this.isAllowed(jid)) return
      this.onInbound(jid, { text: ctx.message.text, sender: String(ctx.from.id) })
    })

    this.bot.on('callback_query:data', async (ctx) => {
      await ctx.answerCallbackQuery()  // Must ack first to remove loading spinner
      await this.handleCallbackQuery(ctx)
    })

    await this.bot.start()
  }

  async sendConfirmation(jid: string, workflow: Workflow): Promise<void> {  // Channel interface
    const keyboard = new InlineKeyboard()
      .text('✅ Confirm', `confirm:${workflow.id}`)
      .text('✏️ Modify', `modify:${workflow.id}`)
      .text('❌ Cancel', `cancel:${workflow.id}`)

    await this.bot.api.sendMessage(Number(jid), formatPlanMarkdownV2(workflow, escapeMdV2), {
      reply_markup: keyboard,
      parse_mode: 'MarkdownV2',    // Must use MarkdownV2 — legacy Markdown is deprecated
    })
  }

  // ... message chunking, typing, etc.
}

/** Escape all MarkdownV2 special characters for Telegram API.
 *  Must be applied to all dynamic text before sending with parse_mode: 'MarkdownV2'. */
function escapeMdV2(text: string): string {
  return text.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, '\\$&')
}
```

### 4.4 Bot Commands

All commands work identically in WhatsApp and Telegram:

| Command | Action |
|---------|--------|
| `/new` or `/new <description>` | Start creating a new workflow |
| `/list` | List all workflows with status |
| `/status <id>` | Show detailed workflow status |
| `/cancel <id>` | Cancel a running workflow |
| `/help` | Show available commands |

For WhatsApp (no slash command support), prefix with `!` instead: `!new`, `!list`, etc.

### 4.5 Plan Confirmation via Bot

- [x] Format plan as a structured message (Markdown for Telegram, plain text for WhatsApp)
- [x] Telegram: inline keyboard buttons for confirm/modify/cancel
- [x] WhatsApp: react-based confirmation (reply with "yes"/"no"/"modify") or numbered options
- [x] Modify flow: bot asks for modification description → sends to Planner → re-sends updated plan
- [x] Timeout: 10-minute confirmation timeout in MessageRouter (expired confirmations are cleared)

```
Bot:  📋 Workflow: GitHub Issue Auto PR

      Trigger: poll (every 60s)

      Steps:
      1. Clone repo and create branch from dev
      2. Analyze issue and generate implementation plan
      3. Commit plan and create Draft PR
      4. Notify user

      [✅ Confirm] [✏️ Modify] [❌ Cancel]
```

### 4.6 Progress Notifications

- [x] When a workflow step starts: send brief status update
- [x] When a workflow completes: send summary with results
- [x] When a workflow fails: send error details with retry/cancel options
- [x] Typing indicator active while agent is executing
- [x] Batch rapid updates (don't send individual messages for every agent event)

### 4.7 Bot Lifecycle Commands

- [x] `/bot start` — start all enabled Bot Channels (TUI slash command only, removed from CLI)
- [x] `/bot status` — show connection status of each Channel (TUI slash command only)
- [x] ~~`cueclaw bot start` CLI subcommand~~ — REMOVED (now TUI-only `/bot start` command)
- [x] ~~`cueclaw bot config`~~ — NOT IMPLEMENTED (setup handled via `cueclaw setup` and config.yaml editing)

### 4.8 ChannelContext Propagation

- [x] `ChannelContext` type added to `types.ts` — identifies channel, chatJid, sender
- [x] Router passes `ChannelContext` through to `generatePlan`, `modifyPlan`, and `PlannerSession`
- [x] Planner system prompt adapts based on channel context:
  - Bot channels: "you have the chat ID, use it for notifications"
  - TUI: "require explicit recipient input"
- [x] `sendMessage` now returns message ID (string) for edit support
- [x] `editMessage` added to Channel interface (optional) — enables in-place status updates
- [x] Router uses `editMessage` for "Generating plan..." → "✅ Plan generated" status flow

---

## Interaction Example (Telegram)

```
User: Create a workflow that monitors acontext/repo issues.
      When an issue is assigned to me, auto-create a branch and draft PR.

Bot:  ⏳ Generating execution plan...

Bot:  📋 Workflow: GitHub Issue Auto PR

      Trigger: poll (every 60s)

      Steps:
      1. Clone repo and create branch from dev
      2. Analyze issue content and generate plan
      3. Commit and create Draft PR
      4. Notify user

      [✅ Confirm] [✏️ Modify] [❌ Cancel]

User: (taps ✅ Confirm)

Bot:  ✅ Workflow activated (wf_abc123)
      Monitoring for new issues...

--- later ---

Bot:  🔔 Workflow triggered: Issue #42 assigned to you
      Step 1/4: Creating branch feature/42-add-login...

Bot:  ✅ Workflow complete!
      Created PR #43: "Add login feature"
      https://github.com/acontext/repo/pull/43
```

### 4.9 Rate Limiting

Bot channels are publicly reachable — a bad actor who knows the bot's phone number or Telegram username can spam messages and run up API costs.

- [x] Per-user rate limit in `MessageRouter.handleInbound()`: max N messages per minute (default: 10, configurable)
- [x] Implemented as a sliding window counter per `chatJid`
- [x] Excess messages receive a short reply: "Rate limited, please wait before sending more messages."
- [x] Rate limit state is in-memory (no persistence needed — resets on daemon restart)

```typescript
const RATE_LIMIT_WINDOW = 60_000  // 1 minute
const RATE_LIMIT_MAX = 10         // messages per window
const CLEANUP_INTERVAL = 5 * 60_000  // 5 minutes

const messageTimestamps = new Map<string, number[]>()

// Periodic cleanup to prevent memory leak from inactive users
setInterval(() => {
  const now = Date.now()
  for (const [jid, timestamps] of messageTimestamps) {
    const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW)
    if (recent.length === 0) {
      messageTimestamps.delete(jid)
    } else {
      messageTimestamps.set(jid, recent)
    }
  }
}, CLEANUP_INTERVAL)

function isRateLimited(chatJid: string): boolean {
  const now = Date.now()
  const timestamps = messageTimestamps.get(chatJid) ?? []
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW)
  recent.push(now)
  messageTimestamps.set(chatJid, recent)
  return recent.length > RATE_LIMIT_MAX
}
```

---

## Acceptance Criteria

- [x] WhatsApp Channel connects via QR scan and persists auth state
- [x] Telegram Channel connects with bot token and responds to messages
- [x] Both channels correctly implement the full `Channel` interface
- [x] Sending a workflow description via Bot triggers Planner and returns a plan
- [x] Plan confirmation via inline keyboard (Telegram) or text reply (WhatsApp) works
- [x] Plan modification flow works end-to-end via Bot
- [x] Execution progress notifications are sent during workflow runs
- [x] `/list` and `/status` commands return correct workflow information
- [x] User allowlist restricts access on Telegram
- [x] Long messages are properly chunked (Telegram 4096 char limit)
- [x] Typing indicator shows during agent execution
- [ ] Reconnection works after network interruption — NOT TESTED
- [x] Per-user rate limiting prevents message spam (default: 10/min)

---

## Dependencies to Install

```bash
pnpm add @whiskeysockets/baileys grammy
```

---

## What This Unlocks

Phase 4 completes the multi-entry interaction model:
- **Phase 6** uses Bot as the second validation entry point alongside TUI
- Users can now create and monitor workflows from their phone via messaging apps
