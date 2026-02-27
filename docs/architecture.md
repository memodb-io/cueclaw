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
2. **Container-Isolated Execution** — Workflow steps run in Docker containers by default. If Docker is unavailable, gracefully falls back to local execution with a warning. OS-level isolation beats app-level permission checks.
3. **Single-Process Architecture** — The daemon is one Node.js process. No microservices. Keep it understandable.
4. **Claude Agent SDK Direct Calls** — Use `@anthropic-ai/claude-agent-sdk`'s `query()` API with streaming output, session management, and MCP server injection.

## Project Structure

Flat `src/` — single-responsibility files laid out directly, no over-layering. Only `channels/` and `tui/` have subdirectories. Tests co-located (`foo.ts` + `foo.test.ts`).

```
cueclaw/
├── src/
│   ├── index.ts                 # Library barrel re-exports
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
│   ├── router.ts                # Message routing, intent classification, confirmation flow
│   ├── service.ts               # System service integration (launchd/systemd)
│   ├── daemon.ts                # Daemon main entry point (startDaemon)
│   │
│   ├── setup.ts                 # Setup orchestrator (runSetup)
│   ├── setup-environment.ts     # Check Docker, Node.js versions
│   ├── setup-container.ts       # Build container image
│   ├── setup-auth.ts            # Validate API key
│   ├── setup-verify.ts          # Container smoke test
│   │
│   ├── channels/
│   │   ├── whatsapp.ts          # WhatsApp Channel (Baileys)
│   │   ├── telegram.ts          # Telegram Channel (grammy)
│   │   └── tui.ts               # TUI Channel (Ink)
│   │
│   └── tui/
│       ├── app.tsx              # Ink root — composition shell (~30 lines)
│       ├── app-provider.tsx     # State management + business logic (context provider)
│       ├── app-layout.tsx       # View routing (reads from context)
│       ├── chat.tsx             # Chat layout shell (MainContent + Composer)
│       ├── main-content.tsx     # Message list, scroll, streaming text, thinking indicator
│       ├── composer.tsx         # Input bar, status bar, command hints
│       ├── banner.tsx           # ASCII art logo with gradient coloring
│       ├── thinking-indicator.tsx # Animated spinner with elapsed time
│       ├── resettable-input.tsx # Input with reset + history navigation
│       ├── half-line-padded-box.tsx # Box with half-line color padding
│       ├── dialog-manager.tsx   # Priority-queued modal dialog system
│       ├── use-keypress.tsx     # Priority-based keyboard dispatch system
│       ├── key-bindings.ts      # Centralized key binding definitions
│       ├── use-input-history.ts # Shell-like up/down input history
│       ├── ui-state-context.ts  # Read-only UI state context
│       ├── ui-actions-context.ts # Action callbacks context
│       ├── color-utils.ts       # Hex/RGB conversion, color interpolation
│       ├── theme.ts             # @inkjs/ui extendTheme + cueclawTheme
│       ├── version.ts           # Dynamic version detection (dev vs package.json)
│       ├── daemon-bridge.ts     # TUI ↔ daemon abstraction (external service or in-process)
│       ├── onboarding.tsx       # Interactive setup wizard
│       ├── renderers.tsx        # WorkflowTable, WorkflowDetail components
│       ├── plan-view.tsx        # Plan display/confirmation
│       ├── execution-view.tsx   # Live execution progress
│       ├── workflow-detail-view.tsx # Workflow detail (trigger, steps, runs)
│       ├── status.tsx           # Running status panel
│       ├── commands/            # Slash command registry + 16 individual command files
│       │   ├── types.ts         # SlashCommand, CommandContext interfaces
│       │   ├── registry.ts      # registerCommand, findCommand, parseSlashCommand
│       │   └── *.ts             # help, list, status, pause, resume, delete, config,
│       │                        #   daemon, info, clear, new, cancel, bot, setup, theme, quit
│       ├── hooks/               # Extracted business logic hooks
│       │   ├── use-daemon-bridge.ts
│       │   ├── use-planner-session.ts
│       │   ├── use-workflow-execution.ts
│       │   ├── use-global-keypress.ts
│       │   ├── use-command-dispatch.ts
│       │   └── exit-helpers.ts
│       ├── messages/            # Per-type message display components
│       │   ├── message-display.tsx
│       │   ├── user-message.tsx, assistant-message.tsx, ...
│       │   └── warning-message.tsx, plan-ready-message.tsx
│       └── theme/               # Full theme system
│           ├── colors-theme.ts  # Raw color palette interface
│           ├── semantic-colors.ts # Semantic color layer
│           ├── themes.ts        # 3 built-in themes (dark, light, dracula)
│           ├── theme-manager.ts # Singleton theme manager
│           └── index.ts         # Lazy proxy for current theme
│
├── container/                   # Agent container (Phase 2: Docker isolation)
│   ├── Dockerfile
│   ├── build.sh
│   └── agent-runner/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts         # Agent entry (query() call, session loop)
│           └── ipc-mcp-stdio.ts # Container-side IPC helpers (plain functions, not MCP server)
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
├── daemon.pid                       # Daemon PID file (written by startDaemon/spawnDaemonProcess)
├── logs/                            # Created by initLogger() at startup
│   ├── daemon.log                   # All process logs (appended via pino multistream)
│   └── executions/
│       └── wf_abc123_2026-02-22.log # Per-workflow execution logs
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

- **External mode** (`isExternal: true`): A system service daemon (launchd/systemd) or background process is running — TUI acts as frontend only
- **In-process mode** (`isExternal: false`): No external daemon — TUI starts `TriggerLoop`, `MessageRouter`, and bot channels in-process

**Discovery mechanism:** At startup, `initDaemonBridge()` checks for a running daemon via two methods:
1. **PID file** (`~/.cueclaw/daemon.pid`): `isDaemonRunning()` reads the PID file and probes `process.kill(pid, 0)` to verify the process is alive
2. **System service** fallback: calls `getServiceStatus()` from `src/service.ts` — checks `launchctl list com.cueclaw` (macOS) or `systemctl --user is-active cueclaw` (Linux)
- If neither detects a running daemon, falls back to in-process mode

Bot channels (Telegram/WhatsApp) can be started lazily via `startBotChannels()` after user confirmation, avoiding startup delays (e.g., WhatsApp QR scan).

## TUI Architecture

The TUI is a decomposed Ink/React application with a layered provider/context/hook architecture:

```
App (app.tsx — ~30 lines, composition shell)
 └─ ThemeProvider (@inkjs/ui)
     └─ KeypressProvider (use-keypress.tsx — priority-based input dispatch)
         └─ DialogManager (dialog-manager.tsx — priority-queued modals)
             └─ AppProvider (app-provider.tsx — state + business logic)
                 └─ AppLayout (app-layout.tsx — view routing)
                     ├─ Onboarding
                     ├─ Chat
                     │   ├─ MainContent (main-content.tsx — messages, scroll, streaming, thinking indicator)
                     │   └─ Composer (composer.tsx — input, status bar, command hints)
                     ├─ PlanView
                     ├─ ExecutionView
                     └─ Status
```

**Context layer** (replaces prop drilling):
- `UIStateContext` (ui-state-context.ts) — read-only state: view, messages, workflow, streaming text, daemon status, theme version, etc.
- `UIActionsContext` (ui-actions-context.ts) — action callbacks: handleChatSubmit, handleConfirm, handleModify, etc.

**Custom hooks** (extracted from the old monolith, in `tui/hooks/`):
- `use-daemon-bridge` — starts daemon bridge, tracks status
- `use-planner-session` — manages planner session, user message handling, cancel generation
- `use-workflow-execution` — manages abort map, confirm/modify/cancel/abort/back actions
- `use-global-keypress` — Ctrl+C (exit dialog), Ctrl+D (workflow table)
- `use-command-dispatch` — dispatches `/`-prefixed commands via registry
- `exit-helpers` — exit logic, farewell message, session duration

**Key systems:**
- `KeypressProvider` — single `useInput` dispatching to priority-sorted handlers (Low=0, Normal=100, High=200, Critical=300)
- `DialogManager` — priority-queued modal dialogs (e.g., exit confirmation), renders at Critical priority to block underlying handlers
- Input history — shell-like up/down arrow navigation via `use-input-history.ts`
- `key-bindings.ts` — centralized key binding definitions

**Theme system** (`tui/theme/` directory):
- `colors-theme.ts` — raw color palette interface (foreground, background, accents, gradients)
- `semantic-colors.ts` — semantic layer (`text.primary`, `status.error`, `border.focused`)
- `themes.ts` — three built-in themes: dark (Catppuccin Mocha), light (Catppuccin Latte), dracula
- `theme-manager.ts` — singleton manager with `setTheme(name)`, live switching
- `index.ts` — lazy proxy that always reflects current theme
- `color-utils.ts` — `hexToRgb`, `rgbToHex`, `interpolateColor` for gradient blending

**Message components** (`tui/messages/`):
- `message-display.tsx` — dispatcher to per-type components
- Per-type: `user-message`, `assistant-message`, `assistant-jsx-message`, `system-message`, `error-message`, `warning-message`, `plan-ready-message`

**Command registry** (`tui/commands/` directory):
- `types.ts` — `SlashCommand` interface with optional `completion` field
- `registry.ts` — `registerCommand`, `getCommands`, `findCommand`, `parseSlashCommand`
- Individual command files: help, list, status, pause, resume, delete, config, daemon, info, clear, new, cancel, bot, setup, theme, quit
- `/theme [dark|light|dracula]` — live theme switching

**Views:** `'onboarding' | 'chat' | 'plan' | 'execution' | 'status' | 'detail'`

**ChatMessage type** (discriminated union):
```typescript
type ChatMessage =
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'assistant-jsx'; content: React.ReactNode }
  | { type: 'system'; text: string }
  | { type: 'error'; text: string }
  | { type: 'warning'; text: string }
  | { type: 'plan-ready'; workflowName: string }
```

### Onboarding Flow

`needsOnboarding()` detects first-run or misconfigured state. The wizard supports:
- **Full mode**: Walk through all steps (API key → base URL → container → Telegram → WhatsApp)
- **Fix-it mode**: Skip to the specific step that needs fixing (based on `validateConfig()` issues)
- **Existing config detection**: Shows current values with option to keep or change
- **Dev vs production**: Dev writes secrets to `.env`, production writes to `config.yaml`
