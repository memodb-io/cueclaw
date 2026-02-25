# CueClaw

Orchestrate agent workflows with natural language. Uses the Claude Agent SDK to generate execution plans, confirm with users, and run workflows in the background.

## Project Status

MVP implemented (Phases 0-6). 119 tests passing across 19 test files.

## Key Concepts

- **Workflow**: Natural language → Planner (LLM) → PlannerOutput → framework fills id/phase/timestamps → Workflow JSON (DAG of steps)
- **Executor**: Parallel DAG execution — independent steps run concurrently via `Promise.all`
- **Channel**: Unified interface for TUI, WhatsApp, Telegram — all share identical capabilities
- **Input References**: `$steps.{id}.output` (step results) and `$trigger_data` (trigger payload), resolved at execution time
- **Session**: Per-step (not per-run) — steps don't share session context to avoid pollution

## Architecture

```
User (TUI / WhatsApp / Telegram)
  → Channel interface → MessageRouter → Planner (LLM)
  → User confirms plan
  → Executor → Agent Runner (Claude Agent SDK query())
  → Results persisted to SQLite
```

## Tech Stack

- TypeScript ESM, Node.js 22+, pnpm
- Vitest for testing, in-memory SQLite for test isolation
- Ink (React) for TUI, baileys for WhatsApp, grammy for Telegram
- pino for structured logging, Zod for validation
- All dependencies use latest versions

## Documentation

- [PLAN.md](PLAN.md) — Overview and milestones
- [plans/](plans/) — Phase implementation docs (phase-0 through phase-6)
- [docs/architecture.md](docs/architecture.md) — System design, project structure, security model
- [docs/types.md](docs/types.md) — Workflow Protocol, Channel interface, DB schema, error types
- [docs/config.md](docs/config.md) — Config format, CLI commands
- [docs/testing.md](docs/testing.md) — Test strategy, mock patterns, CI
- [docs/references.md](docs/references.md) — NanoClaw source index, design references

## Conventions

- Flat `src/` layout — no deep nesting, only `channels/` and `tui/` subdirectories
- Co-located tests: `foo.ts` + `foo.test.ts`
- Error types: `CueclawError` base → `PlannerError`, `ExecutorError`, `TriggerError`, `ConfigError`
- DB tests use `Database(':memory:')`, never touch the filesystem
- LLM generates `PlannerOutput` (no framework fields), framework wraps into `Workflow`
- Channel interface includes `sendConfirmation()` — each channel renders confirmation differently

## Release Process

- Uses [changesets](https://github.com/changesets/changesets) for versioning and npm publishing
- **When to add a changeset**: PRs that affect published code (features, fixes, API changes)
- **When NOT needed**: docs, CI config, tests-only, internal refactors
- Developer workflow: run `pnpm changeset` before submitting PR, select patch/minor/major, write summary
- CI creates a "Version Packages" PR that bumps package.json + generates CHANGELOG.md
- Merging the Version PR triggers automatic `npm publish` + git tag
- npm authentication uses OIDC Trusted Publishing (no NPM_TOKEN needed), requires configuring Trusted Publisher on npmjs.com
