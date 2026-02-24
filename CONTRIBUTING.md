# Contributing to CueClaw

Thanks for your interest in contributing to CueClaw! This document covers everything you need to get started.

## Prerequisites

- Node.js 22+
- pnpm
- Docker (for container isolation features)

## Setup

```bash
git clone https://github.com/memodb-io/cueclaw.git
cd cueclaw
pnpm install
```

## Project Structure

```
src/
  channels/       # WhatsApp, Telegram channel implementations
  tui/            # Ink-based terminal UI components
  *.ts            # All other modules live flat in src/
  *.test.ts       # Co-located test files
docs/             # Architecture, types, config, testing docs
plans/            # Phase implementation plans (phase-0 through phase-6)
```

Flat `src/` layout — no deep nesting. Only `channels/` and `tui/` are subdirectories.

## Development Workflow

1. Fork the repo and create a feature branch from `main`
2. Make your changes
3. Add or update tests (co-located: `foo.ts` + `foo.test.ts`)
4. Ensure all checks pass:

```bash
pnpm build
pnpm test
```

5. Submit a pull request against `main`

## Code Conventions

- **TypeScript ESM** — all source uses ES modules
- **Co-located tests** — test files live next to their source: `planner.ts` + `planner.test.ts`
- **Error hierarchy** — use the `CueclawError` base class; subclasses include `PlannerError`, `ExecutorError`, `TriggerError`, `ConfigError`
- **Logging** — use pino for structured logging
- **Validation** — use Zod schemas for runtime validation
- **Dependencies** — use latest versions; `pnpm-lock.yaml` handles reproducibility

## Testing

- **Unit tests**: `pnpm test` — fast, no external dependencies
- **Integration tests**: `pnpm test:integration` — mock agent runner, in-memory DB
- **DB tests** use `Database(':memory:')` — never touch the filesystem
- **Mock external dependencies** at module boundaries, not internal code
- **Fake timers** for timeout/timer logic

See [docs/testing.md](docs/testing.md) for detailed mock patterns and test layer guidance.

## Pull Requests

- Keep PRs focused — one feature or fix per PR
- PRs trigger typecheck + vitest in CI
- Include a clear description of what changed and why
- Reference related issues if applicable

## Architecture Notes

Before contributing to a specific area, review the relevant docs:

- [PLAN.md](PLAN.md) — milestones and phase overview
- [docs/architecture.md](docs/architecture.md) — system design and project structure
- [docs/types.md](docs/types.md) — Workflow Protocol, Channel interface, DB schema
- [docs/config.md](docs/config.md) — config format and CLI commands

Key design decisions:

- **LLM outputs `PlannerOutput`** (no framework fields) — the framework wraps it into a `Workflow`
- **Input references** (`$steps.{id}.output`, `$trigger_data`) are resolved at execution time
- **Sessions are per-step**, not per-run — steps don't share session context
- **Channel interface** includes `sendConfirmation()` — each channel renders confirmation its own way

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
