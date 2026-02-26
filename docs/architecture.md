# Architecture

## Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        CueClaw Core                          │
│                                                              │
│  ┌───────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ Workflow  │  │   Planner    │  │      Executor         │  │
│  │ Registry  │  │  (LLM-based  │  │  (Claude Agent SDK)   │  │
│  │           │  │   dynamic)   │  │  query() API          │  │
│  └───────────┘  └──────────────┘  └───────────────────────┘  │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐     │
│  │  Trigger     │  │   Session    │  │   Notifier      │     │
│  │  poll/cron/  │  │   Manager    │  │  (multi-channel │     │
│  │  manual      │  │              │  │   notification) │     │
│  └──────────────┘  └──────────────┘  └─────────────────┘     │
│                                                              │
├──────────────────────┬───────────────────────────────────────┤
│     TUI Interface    │          Bot Interface                │
│     (Ink/React)      │  (WhatsApp/Telegram/...)              │
└──────────────────────┴───────────────────────────────────────┘
```

## Framework vs. SDK Responsibilities

CueClaw uses the Claude Agent SDK as its fixed execution engine.

**Framework manages:**
- Workflow orchestration (plan → confirm → execute)
- Triggers (poll/cron/manual)
- Multi-channel notification (TUI / WhatsApp / Telegram)
- Concurrency control (GroupQueue)
- Execution record persistence (SQLite)

**SDK handles:**

| Concern | How | Owner |
|---------|-----|-------|
| Skills Loading | SDK `settingSources` loads `.claude/skills/` **when configured with** `['project']` (default is `[]`) | SDK |
| Tool Discovery | Agent has Bash, figures it out | Agent |
| Permission Control | Container isolation + PreToolUse hook | SDK hooks + Docker |
| Session Resume | SDK `resume` parameter | SDK |
| Transcript Compaction | SDK `PreCompact` hook | SDK |

## Design Principles

1. **Skills-over-Features** — Keep the core minimal. No built-in service-specific logic. Need GitHub capabilities? Write a skill in `.claude/skills/`, or let the agent infer.
2. **Container-Isolated Execution** — Workflow steps run in Docker containers (future). OS-level isolation beats app-level permission checks.
3. **Single-Process Architecture** — The daemon is one Node.js process. No microservices. Keep it understandable.
4. **Claude Agent SDK Direct Calls** — Use `@anthropic-ai/claude-agent-sdk`'s `query()` API with streaming output, session management, and MCP server injection.

## Project Structure

Flat `src/` — single-responsibility files laid out directly, no over-layering. Only `channels/` and `tui/` have subdirectories. Tests co-located (`foo.ts` + `foo.test.ts`).

```
cueclaw/
├── src/
│   ├── index.ts                 # Main orchestrator: state mgmt, message loop, agent calls
│   ├── cli.ts                   # CLI entry (commander)
│   ├── config.ts                # Config constants, paths, env vars
│   ├── types.ts                 # Centralized type definitions
│   ├── logger.ts                # pino structured logging
│   ├── env.ts                   # .env parsing + auto-inject into process.env
│   │
│   ├── planner.ts               # LLM Planner — natural language → Workflow JSON
│   ├── planner-session.ts       # Multi-turn conversation session (ask → clarify → create)
│   ├── anthropic-client.ts      # Anthropic SDK client factory (official API vs third-party proxies)
│   ├── executor.ts              # Execute steps by DAG (parallel), invoke agent
│   ├── agent-runner.ts          # Claude Agent SDK query() wrapper
│   ├── hooks.ts                 # PreToolUse, PreCompact hooks
│   ├── session.ts               # Session resume, compaction
│   │
│   ├── workflow.ts              # Workflow definition, registration, state machine
│   ├── trigger.ts               # Triggers (poll/cron/manual)
│   ├── trigger-loop.ts          # Daemon trigger polling loop
│   ├── group-queue.ts           # Concurrency control (FIFO + global cap)
│   │
│   ├── db.ts                    # SQLite init + CRUD
│   ├── ipc.ts                   # IPC watcher (host ↔ container file polling)
│   ├── mcp-server.ts            # CueClaw MCP Server (injected into container agent)
│   ├── container-runner.ts      # Docker spawn, stdin/stdout protocol, mounts
│   ├── mount-security.ts        # Mount allowlist validation
│   ├── router.ts                # Message formatting, outbound routing
│   ├── service.ts               # System service integration (launchd/systemd)
│   │
│   ├── channels/
│   │   ├── whatsapp.ts          # WhatsApp Channel (Baileys)
│   │   ├── telegram.ts          # Telegram Channel (grammy)
│   │   └── tui.ts               # TUI Channel (Ink)
│   │
│   └── tui/
│       ├── app.tsx              # Ink root component — multi-view (onboarding/chat/execution)
│       ├── theme.ts             # @inkjs/ui extendTheme — semantic color definitions
│       ├── version.ts           # Dynamic version detection (dev vs package.json)
│       ├── chat.tsx             # Chat component (messages, streaming, command autocomplete)
│       ├── commands.ts          # Slash command registry (15+ commands: /help, /list, /status, etc.)
│       ├── daemon-bridge.ts     # TUI ↔ daemon abstraction (external service or in-process)
│       ├── onboarding.tsx       # Interactive setup wizard (API key, base URL, bots)
│       ├── renderers.tsx        # Workflow display components (WorkflowTable, WorkflowDetail)
│       ├── plan-view.tsx        # Plan display/confirmation component
│       ├── execution-view.tsx   # Live execution progress panel
│       └── status.tsx           # Running status panel
│
├── container/                   # Agent container (Phase 2: Docker isolation)
│   ├── Dockerfile
│   ├── build.sh
│   └── agent-runner/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts         # Agent entry (query() call, session loop)
│           └── ipc-mcp-stdio.ts # Container-side MCP server
│
├── setup/                       # Install/init
│   ├── index.ts
│   ├── environment.ts
│   ├── container.ts
│   ├── auth.ts
│   ├── service.ts
│   └── verify.ts
│
├── plans/                       # Implementation phase docs
├── docs/                        # Architecture & reference docs
├── config.yaml                  # Default config
├── .env.example
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── CLAUDE.md                    # AI assistant context
└── README.md
```

## Data Directory

```
~/.cueclaw/
├── config.yaml                      # Config (Claude API, Bot tokens, etc.)
├── db/
│   └── cueclaw.db                   # SQLite
├── logs/
│   ├── daemon.log                   # Daemon main process log
│   └── executions/
│       └── wf_abc123_2026-02-22.log
├── ipc/
│   └── {workflow_id}/
│       └── {step_id}/
│           ├── input/
│           └── output/
├── mount-allowlist.json             # Container mount security boundary
└── cache/
```

**Config priority** (low → high): `~/.cueclaw/config.yaml` → `./.cueclaw/config.yaml` → env vars → CLI args

## Security Model

```
Level 0: Plan Confirmation (Human-in-the-Loop)
  → User must confirm plan before execution

Level 1: Mount Allowlist (Filesystem Boundary)
  → ~/.cueclaw/mount-allowlist.json controls accessible directories
  → Default block: .ssh, .gnupg, .aws, .env, credentials, private keys

Level 2: Docker Container Isolation (OS-level) [Phase 2]
  → Each workflow step runs in a container
  → Only allowlisted directories mounted
  → Non-privileged user execution
  → See plans/phase-2-container-isolation.md

Level 3: Tool Allowlist (Application-level)
  → config.yaml can restrict allowed tools
  → Per-workflow tool permission configuration
```

Local mode uses Level 0 + Level 3 + PreToolUse hooks (see plans/phase-1-core-engine.md § 1.8). Container mode adds Level 1 + Level 2 (see plans/phase-2-container-isolation.md).

## Multi-Turn Planner Session

The planner supports iterative conversation via `PlannerSession`:

```
User message → PlannerSession
  → LLM responds with one of three tools:
    1. ask_question → Clarifying question sent back to user → wait for reply → loop
    2. set_secret   → Store credential in env → auto-continue (LLM may ask more or create plan)
    3. create_workflow → Final plan generated → awaiting_confirmation
  → Or plain text response (no tool call)
```

The session maintains full message history so the LLM has context across turns. The `set_secret` tool automatically persists credentials (`.env` in dev, `process.env` in production) and recursively continues the conversation.

## Anthropic Client Factory

`createAnthropicClient(config)` handles authentication differences between the official API and third-party proxies (e.g., OpenRouter):

- **Official API** (`base_url = https://api.anthropic.com`): Uses `apiKey` parameter
- **Third-party proxy** (any other `base_url`): Uses `authToken` parameter with empty `apiKey` to bypass proxy API key validation

## Daemon Bridge

The TUI uses a `DaemonBridge` abstraction to decouple from the backend daemon:

- **External mode** (`isExternal: true`): A system service daemon (launchd/systemd) is running — TUI acts as frontend only
- **In-process mode** (`isExternal: false`): No external daemon — TUI starts `TriggerLoop`, `MessageRouter`, and bot channels in-process

Bot channels (Telegram/WhatsApp) can be started lazily via `startBotChannels()` after user confirmation, avoiding startup delays (e.g., WhatsApp QR scan).

## TUI Architecture

The TUI is a multi-view Ink/React application:

```
┌─────────────────────────────────────────┐
│ App                                      │
│ ┌─────────────────────────────────────┐  │
│ │ View: Onboarding                    │  │  First-run setup wizard
│ │  → API Key → Base URL → Container   │  │  (skipped if configured)
│ │  → Telegram → WhatsApp → Done       │  │
│ └─────────────────────────────────────┘  │
│ ┌─────────────────────────────────────┐  │
│ │ View: Chat                          │  │  Main interaction view
│ │  → Slash commands (/help, /list...) │  │  Multi-turn planner conversation
│ │  → Command autocomplete             │  │  Streaming text display
│ └─────────────────────────────────────┘  │
│ ┌─────────────────────────────────────┐  │
│ │ View: Plan / Execution              │  │  Plan confirmation (Y/M/N)
│ │  → Plan confirmation                │  │  Live execution progress
│ │  → Real-time step progress          │  │
│ └─────────────────────────────────────┘  │
└─────────────────────────────────────────┘

Slash Commands (tui/commands.ts):
  /help, /list, /status, /pause, /resume, /delete,
  /config, /daemon, /info, /clear, /new, /cancel,
  /bot, /setup
```

### Onboarding Flow

`needsOnboarding()` detects first-run or misconfigured state. The wizard supports:
- **Full mode**: Walk through all steps (API key → base URL → container → Telegram → WhatsApp)
- **Fix-it mode**: Skip to the specific step that needs fixing (based on `validateConfig()` issues)
- **Existing config detection**: Shows current values with option to keep or change
- **Dev vs production**: Dev writes secrets to `.env`, production writes to `config.yaml`
