# CueClaw

Orchestrate agent workflows with natural language. Uses the Claude Agent SDK to generate execution plans, confirm with users, and run workflows in the background.

## Project Status

MVP implemented (Phases 0-6) with multi-turn planner, decomposed TUI (context/hook architecture), daemon bridge with PID file management, and channel-aware planner. ~316 tests across 33 test files.

## Key Concepts

- **Workflow**: Natural language → Planner (LLM) → PlannerOutput → framework fills id/phase/timestamps → Workflow JSON (DAG of steps)
- **Planner Session**: Multi-turn conversation with the planner — clarify requirements, store credentials, then generate workflow
- **Executor**: Parallel DAG execution — independent steps run concurrently via `Promise.all`
- **Channel**: Unified interface for TUI, WhatsApp, Telegram — `sendMessage` returns message ID, optional `editMessage` for in-place status updates
- **ChannelContext**: Identifies channel + sender, threaded through planner for channel-aware system prompt (bot vs TUI)
- **Daemon Bridge**: Abstraction between TUI and backend — detects external daemon via PID file (`~/.cueclaw/daemon.pid`) or system service
- **TUI Architecture**: Decomposed into providers (ThemeProvider → KeypressProvider → DialogManager → AppProvider → AppLayout), context layer (UIStateContext + UIActionsContext), custom hooks (6 in `tui/hooks/`), command registry (`tui/commands/`), theme system (`tui/theme/` with 3 built-in themes), per-type message components (`tui/messages/`)
- **Input References**: `$steps.{id}.output` (step results) and `$trigger_data` (trigger payload), resolved at execution time
- **Container Execution**: Opt-in via `container.enabled: true` in config.yaml — dev mode uses `cueclaw-agent:latest` (local build via `container/build.sh`), production uses version-pinned `ghcr.io/memodb-io/cueclaw-agent:{version}` with auto-pull from GHCR; falls back to local execution if Docker is unavailable or pull fails
- **Session**: Per-step (not per-run) — steps don't share session context to avoid pollution
- **File Logging**: `initLogger()` writes to `~/.cueclaw/logs/daemon.log` (all processes) and `executions/` subdir (per-workflow); composes with TUI in-memory stream via pino multistream

## Architecture

```
User (TUI / WhatsApp / Telegram)
  → Channel interface → MessageRouter → PlannerSession (multi-turn)
  → Planner asks questions / stores secrets → User confirms plan
  → Executor → Agent Runner (Claude Agent SDK query())
  → Results persisted to SQLite

TUI: App → ThemeProvider → KeypressProvider → DialogManager → AppProvider → AppLayout
     Views: Onboarding | Chat (MainContent + Composer) | Plan | Execution | Status | Detail
     DaemonBridge (PID file or system service detection, in-process fallback)
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

## Development Workflow

When implementing code changes, always follow **docs-first** order:

1. **Read** `PLAN.md`, relevant `plans/` phase docs, and `docs/` to understand the current design
2. **Update** `PLAN.md`, `plans/`, and `docs/` first — reflect the new design, types, or behavior before writing code
3. **Implement** the code changes
4. **Update** `CLAUDE.md` if key concepts, conventions, or project status changed

Never write code that contradicts existing documentation. If the design needs to change, update the docs first.

## Conventions

- Flat `src/` layout — no deep nesting, only `channels/` and `tui/` subdirectories (TUI has sub-dirs: `commands/`, `hooks/`, `messages/`, `theme/`)
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

Single workflow: `ci.yml` — runs on every push to `main`, all PRs, and `workflow_dispatch`.

**Jobs** (all in `ci.yml`):
- **test**: build + `vitest run`
- **lint**: `eslint`
- **typecheck**: `tsc --noEmit`
- **changeset**: PR-only, warns if changeset is missing (non-blocking)
- **release**: `needs: [test, lint, typecheck]`, runs on push to `main` or `workflow_dispatch` only — uses [changesets](https://github.com/changesets/changesets) for versioning, npm publishing, and GHCR container image push

**Flow**:
1. PR with `.changeset/*.md` file merged to `main`
2. CI + release job runs → `changesets/action` detects pending changesets → creates "Version Packages" PR (bumps `package.json`, updates `CHANGELOG.md`, deletes changeset files)
3. Merge the Version PR → use `workflow_dispatch` to trigger CI → `changeset publish` publishes to npm + creates git tag + GitHub Release automatically
4. If published, builds `container/agent-runner`, then docker builds and pushes the agent image to GHCR with version and latest tags
5. If no pending changesets exist, the release job is a no-op

**Why `workflow_dispatch`**: Version Packages PRs are authored by `github-actions[bot]` via `GITHUB_TOKEN`. GitHub does not fire workflow events for bot-authored commits, so merging the Version PR won't auto-trigger CI. Use the "Run workflow" button in GitHub Actions UI (or `gh workflow run CI`) after merging.

**When to add a changeset**: PRs that affect published code (features, fixes, API changes)
**When NOT needed**: docs, CI config, tests-only, internal refactors
**Developer workflow**: run `pnpm changeset` before submitting PR, select patch/minor/major, write summary

**Auth**: npm OIDC Trusted Publishing (bound to `ci.yml`), GHCR via `GITHUB_TOKEN` (packages: write permission)
