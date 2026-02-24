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
│   ├── env.ts                   # .env parsing (secrets NOT in process.env)
│   │
│   ├── planner.ts               # LLM Planner — natural language → Workflow JSON
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
│       ├── app.tsx              # Ink root component + ThemeProvider
│       ├── theme.ts             # @inkjs/ui extendTheme — semantic color definitions
│       ├── banner.tsx           # ASCII logo
│       ├── chat.tsx             # Chat component
│       ├── plan-view.tsx        # Plan display/confirmation component
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
