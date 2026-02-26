# CueClaw

Orchestrate agent workflows with natural language. Uses the Claude Agent SDK to generate execution plans, confirm with users, and run workflows in the background.

## Project Status

MVP implemented (Phases 0-6) with multi-turn planner, TUI slash commands, and daemon bridge. ~177 tests across 23 test files.

## Key Concepts

- **Workflow**: Natural language → Planner (LLM) → PlannerOutput → framework fills id/phase/timestamps → Workflow JSON (DAG of steps)
- **Planner Session**: Multi-turn conversation with the planner — clarify requirements, store credentials, then generate workflow
- **Executor**: Parallel DAG execution — independent steps run concurrently via `Promise.all`
- **Channel**: Unified interface for TUI, WhatsApp, Telegram — all share identical capabilities
- **Daemon Bridge**: Abstraction between TUI and backend — detects external system service or runs in-process
- **Input References**: `$steps.{id}.output` (step results) and `$trigger_data` (trigger payload), resolved at execution time
- **Session**: Per-step (not per-run) — steps don't share session context to avoid pollution

## Architecture

```
User (TUI / WhatsApp / Telegram)
  → Channel interface → MessageRouter → PlannerSession (multi-turn)
  → Planner asks questions / stores secrets → User confirms plan
  → Executor → Agent Runner (Claude Agent SDK query())
  → Results persisted to SQLite

TUI: Onboarding → Chat (slash commands) → Plan View → Execution View
     DaemonBridge (external service or in-process TriggerLoop + bot channels)
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

## Commit Convention

- Follows [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): description`
- Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `perf`
- Enforced by commitlint via git hook (simple-git-hooks)
- After cloning, run `pnpm install` to set up hooks automatically

## CI / CD

### CI (`ci.yml`)

Runs on every push to `main` and all PRs — 4 parallel jobs:
- **test**: build + `vitest run`
- **lint**: `eslint`
- **typecheck**: `tsc --noEmit`
- **changeset**: PR-only, warns if changeset is missing (non-blocking)

### Release (`release.yml`)

Runs on push to `main` only. Uses [changesets](https://github.com/changesets/changesets) for versioning and npm publishing.

**Flow**:
1. PR with `.changeset/*.md` file merged to `main`
2. Release workflow runs → `changesets/action` detects pending changesets → creates "Version Packages" PR (bumps `package.json`, updates `CHANGELOG.md`, deletes changeset files)
3. Merge the Version PR → Release workflow runs again → `changeset publish` publishes to npm + creates git tag + GitHub Release automatically
4. If no pending changesets exist, the workflow is a no-op

**When to add a changeset**: PRs that affect published code (features, fixes, API changes)
**When NOT needed**: docs, CI config, tests-only, internal refactors
**Developer workflow**: run `pnpm changeset` before submitting PR, select patch/minor/major, write summary

**Auth**: npm OIDC Trusted Publishing (no NPM_TOKEN)
