# CueClaw — Implementation Plan

> Orchestrate agent workflows with natural language.

## Overview

CueClaw lets you describe a workflow in natural language. It uses the Claude Agent SDK to automatically orchestrate an execution plan, presents it for user confirmation, then runs it in the background. Interact via TUI or Bot (WhatsApp / Telegram).

## Core Philosophy

1. **Natural Language as Orchestration** — No YAML/JSON authoring. Describe "when X happens, do Y" in plain language.
2. **Plan → Confirm → Execute** — Show the plan first, execute after approval.
3. **Local-First** — Fixed on the Claude Agent SDK; agents leverage locally available tools.
4. **Unified Multi-Entry** — TUI and Bots share identical interaction capabilities.
5. **Extensible** — Drop markdown teaching docs in `.claude/skills/` to expand agent capabilities.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript (ESM), Node.js 22+ |
| Package Manager | pnpm |
| TUI | Ink (React for CLI) |
| Bot Channels | @whiskeysockets/baileys (WhatsApp), grammy (Telegram) |
| LLM | Anthropic SDK (Planner), @anthropic-ai/claude-agent-sdk (Executor) |
| Persistence | SQLite (better-sqlite3) |
| Logging | pino + pino-pretty |
| Config | YAML + Zod validation |
| Build | tsup |
| Testing | Vitest |

All dependencies use latest versions. `pnpm-lock.yaml` handles reproducibility.

## Milestones

| Milestone | Content | Acceptance Criteria |
|-----------|---------|-------------------|
| **M0** | Scaffolding + CLI + Config | `cueclaw` command runs, loads config, SQLite ready |
| **M1** | Planner + Plan Confirmation | NL → multi-turn planner (ask_question/set_secret/create_workflow) → display → confirm/modify/cancel |
| **M2** | Container Isolation | Docker execution, IPC, MCP tools, mount security, `cueclaw setup` |
| **M3** | TUI Interface | Ink TUI for conversational workflow creation + management |
| **M4** | Bot Channels | WhatsApp + Telegram with same capabilities as TUI |
| **M5** | Triggers + Daemon | poll/cron triggers + launchd/systemd background execution |
| **M6** | MVP Validation | Two real GitHub workflows running continuously |

## Phase Documents

Implementation phases. Phase 3 and Phase 4 are independent and can be developed in parallel.

1. **[Phase 0: Project Scaffolding](plans/phase-0-scaffolding.md)** — CLI, config, database, logging, types
2. **[Phase 1: Core Engine](plans/phase-1-core-engine.md)** — Multi-turn Planner (ask_question/set_secret/create_workflow), Executor (parallel DAG), Agent Runner, sessions
3. **[Phase 2: Container Isolation](plans/phase-2-container-isolation.md)** — Docker execution, IPC, MCP tools, mount security (depends on Phase 1)
4. **[Phase 3: TUI Interface](plans/phase-3-tui.md)** — Ink-based terminal UI (depends on Phase 0+1)
5. **[Phase 4: Bot Channels](plans/phase-4-bot-channels.md)** — WhatsApp + Telegram (depends on Phase 0+1)
6. **[Phase 5: Daemon & Triggers](plans/phase-5-daemon-triggers.md)** — Background service, triggers, concurrency
7. **[Phase 6: MVP Validation](plans/phase-6-mvp-validation.md)** — End-to-end validation + integration tests

## Reference Documents

- **[Architecture](docs/architecture.md)** — System overview, project structure, security model
- **[Types](docs/types.md)** — Workflow Protocol v1, Channel interface, DB schema, error hierarchy
- **[Config](docs/config.md)** — Config file format, CLI commands, multi-model strategy
- **[Testing](docs/testing.md)** — Test strategy, mock patterns, CI config
- **[References](docs/references.md)** — NanoClaw source index, external design references

## Future Directions

- More Bots: Discord, Slack, WeChat
- Other LLM Providers: OpenAI-compatible API via base_url
- Web UI: DAG visualization (React Flow / D3)
- Webhook Triggers: Replace polling for real-time
- Workflow Template Marketplace: Export/import Workflow JSON
- HTTP API: Programmatic access for Web UI / mobile
