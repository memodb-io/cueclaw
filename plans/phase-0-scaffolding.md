# Phase 0: Project Scaffolding

> **Goal:** Lay the foundation — a runnable `cueclaw` CLI with config loading, SQLite database, structured logging, and all core type definitions.
>
> **Prerequisites:** None (this is the starting point)

---

## What Gets Built

By the end of Phase 0, you can run `cueclaw` and see a help message. Config loads from YAML, SQLite is initialized, and the type system is in place for all subsequent phases.

```
cueclaw --help        # Shows available commands
cueclaw info          # Shows loaded config, paths, versions
cueclaw config get    # Reads config values
```

---

## Tasks

### 0.1 Initialize Project

- [ ] `pnpm init` with ESM config (`"type": "module"`)
- [ ] TypeScript config (`tsconfig.json`) targeting ES2022, NodeNext module resolution
- [ ] ESLint flat config with TypeScript plugin
- [ ] Vitest config (`vitest.config.ts`)
- [ ] tsup/tsdown build config for `src/cli.ts` → `dist/cli.js`
- [ ] `.gitignore` (node_modules, dist, *.db, .env, ~/.cueclaw)
- [ ] `.env.example` with `ANTHROPIC_API_KEY` placeholder

```json
// package.json essentials
{
  "name": "cueclaw",
  "type": "module",
  "bin": { "cueclaw": "./dist/cli.js" },
  "scripts": {
    "build": "tsup src/cli.ts --format esm",
    "dev": "tsx src/cli.ts",
    "test": "vitest",
    "lint": "eslint src/"
  }
}
```

### 0.2 CLI Skeleton (`src/cli.ts`)

- [ ] Use `commander` for CLI argument parsing
- [ ] Register subcommands: `new`, `list`, `status`, `pause`, `resume`, `delete`, `daemon`, `info`, `bot`, `tui`, `config`
- [ ] Default command (no args) = `tui` (stub for now — just prints "TUI coming in Phase 3")
- [ ] `cueclaw info` prints loaded config summary
- [ ] `--version` flag from package.json
- [ ] Shebang line (`#!/usr/bin/env node`) in CLI entry

```typescript
// src/cli.ts — skeleton
import { Command } from 'commander'
import { loadConfig } from './config.js'
import { initDb } from './db.js'
import { logger } from './logger.js'

const program = new Command()
  .name('cueclaw')
  .description('Orchestrate agent workflows with natural language')
  .version('0.1.0')

program.command('info').action(async () => {
  const config = loadConfig()
  logger.info({ config }, 'CueClaw configuration')
})

// ... register other subcommands as stubs

program.parse()
```

### 0.3 Config System (`src/config.ts`)

- [ ] Load YAML with priority chain: `~/.cueclaw/config.yaml` → `./.cueclaw/config.yaml` → env vars → CLI args
- [ ] Zod schema for validation with clear error messages
- [ ] `ensureCueclawHome()` — create `~/.cueclaw/` directory structure on first run
- [ ] Support `${ENV_VAR}` interpolation in YAML values
- [ ] Export typed config object

```typescript
// src/config.ts — key types
import { z } from 'zod'

const ConfigSchema = z.object({
  claude: z.object({
    api_key: z.string(),
    base_url: z.string().url().default('https://api.anthropic.com'),
    planner: z.object({ model: z.string().default('claude-sonnet-4-6') }),
    executor: z.object({ model: z.string().default('claude-sonnet-4-6') }),
  }),
  identity: z.object({ name: z.string() }).optional(),
  whatsapp: z.object({
    enabled: z.boolean().default(false),
    auth_dir: z.string().default('~/.cueclaw/auth/whatsapp'),
    allowed_jids: z.array(z.string()).default([]),  // Empty = allow all
  }).optional(),
  telegram: z.object({
    enabled: z.boolean().default(false),
    token: z.string().optional(),
    allowed_users: z.array(z.string()).default([]),
  }).optional(),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    dir: z.string().default('~/.cueclaw/logs'),
  }).optional(),
}).passthrough()  // Tolerate future keys (e.g., container) without validation errors

export type CueclawConfig = z.infer<typeof ConfigSchema>
```

### 0.4 Environment & Secrets (`src/env.ts`)

- [ ] Parse `.env` file using `dotenv.parse(readFileSync('.env'))` — returns a plain object without writing to `process.env`
- [ ] Secrets stored in memory object, NOT in `process.env`
- [ ] Export `getSecret(key: string): string | undefined`
- [ ] Warn if `ANTHROPIC_API_KEY` is missing on startup

### 0.5 Logger (`src/logger.ts`)

- [ ] pino with pino-pretty for development
- [ ] Log level from config
- [ ] Child loggers with context (`{ workflowId, step }`)
- [ ] Log to file in daemon mode (`~/.cueclaw/logs/daemon.log`)

```typescript
import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
})
```

### 0.6 Type Definitions (`src/types.ts`)

- [ ] All core types from [docs/types.md](../docs/types.md): `PlannerOutput`, `Workflow`, `PlanStep`, `StepStatus`, `WorkflowPhase`, `TriggerConfig`, `FailurePolicy`
- [ ] `Channel` interface (including `sendConfirmation`) and `OnInboundMessage` type
- [ ] `NewMessage` type for inbound messages
- [ ] CueClaw MCP tool input types
- [ ] Error hierarchy: `CueclawError` base class + `PlannerError`, `ExecutorError`, `TriggerError`, `ConfigError`
- [ ] Export everything — this file is imported by nearly every module

```typescript
// src/types.ts — error hierarchy
export class CueclawError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message)
    this.name = 'CueclawError'
  }
}

export class PlannerError extends CueclawError {
  constructor(message: string) { super(message, 'PLANNER_ERROR') }
}
export class ExecutorError extends CueclawError {
  constructor(message: string) { super(message, 'EXECUTOR_ERROR') }
}
export class TriggerError extends CueclawError {
  constructor(message: string) { super(message, 'TRIGGER_ERROR') }
}
export class ConfigError extends CueclawError {
  constructor(message: string) { super(message, 'CONFIG_ERROR') }
}
```

### 0.7 SQLite Database (`src/db.ts`)

- [ ] Initialize `better-sqlite3` with WAL mode
- [ ] Create all tables from the schema (see [docs/types.md](../docs/types.md#database-schema-sqlite))
- [ ] Inline migration system: version check on startup, `ALTER TABLE` for incremental changes
- [ ] Basic CRUD helpers: `insertWorkflow`, `getWorkflow`, `updateWorkflowPhase`, etc.
- [ ] DB file location: `~/.cueclaw/db/cueclaw.db`

```typescript
import Database from 'better-sqlite3'
import { join } from 'path'
import { cueclawHome } from './config.js'

export function initDb(): Database.Database {
  const dbPath = join(cueclawHome(), 'db', 'cueclaw.db')
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  runMigrations(db)
  return db
}
```

### 0.8 Default Config File

- [ ] Create `config.yaml` template in the repo root (for reference)
- [ ] First-run experience: if `~/.cueclaw/config.yaml` doesn't exist, copy template and prompt user to fill in API key

---

## Acceptance Criteria

- [ ] `pnpm build` succeeds with no errors
- [ ] `pnpm test` runs (even with zero tests — Vitest initializes cleanly)
- [ ] `pnpm lint` passes
- [ ] `cueclaw --version` prints version
- [ ] `cueclaw --help` shows all subcommand stubs
- [ ] `cueclaw info` loads config and prints summary (or prompts for first-time setup)
- [ ] `~/.cueclaw/` directory structure is created automatically
- [ ] `~/.cueclaw/db/cueclaw.db` is created with all tables
- [ ] Zod config validation catches malformed YAML with clear error messages

---

## Dependencies to Install

```bash
pnpm add commander zod yaml better-sqlite3 pino pino-pretty dotenv
pnpm add -D typescript @types/node @types/better-sqlite3 tsup vitest @vitest/coverage-v8 eslint
```

> **Version strategy:** All dependencies use latest — no pinned version numbers. `pnpm-lock.yaml` handles reproducible builds.

---

## What This Unlocks

Phase 0 provides the foundation that every subsequent phase depends on:
- **Phase 1** uses `types.ts`, `db.ts`, `config.ts`, and `logger.ts`
- **Phase 2** uses `config.ts` for container settings
- **Phase 3** uses `cli.ts` to register the `tui` command
- **Phase 4** uses `config.ts` for Bot tokens and `types.ts` for Channel interface
- **Phase 5** uses `db.ts` for persistence and `config.ts` for daemon settings
