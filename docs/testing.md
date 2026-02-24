# Testing Strategy

## Principles

1. **Test your code, not external services** — don't mock the Anthropic API itself; mock the boundary between your code and external dependencies
2. **In-memory SQLite** — all database tests use `Database(':memory:')` for speed and isolation
3. **Co-located tests** — `foo.ts` + `foo.test.ts` side by side
4. **CI must pass** — PRs trigger typecheck + vitest run

## Test Layers

| Layer | What to Test | What to Mock | Example |
|-------|-------------|-------------|---------|
| **DB** | Schema, CRUD, migrations | None (use `:memory:` DB) | `db.test.ts`: insertWorkflow → getWorkflow assert consistency |
| **Planner** | Output Workflow JSON is structurally valid | Anthropic SDK `client.messages.create` returns fixed tool_use response | `planner.test.ts`: mock LLM response → verify Zod parse passes, DAG is acyclic |
| **Executor** | DAG scheduling order, parallel execution, dependency resolution, failure policy | `agent-runner.ts` entire module (returns fixed output) | `executor.test.ts`: 3-step DAG → verify parallel execution, skip logic |
| **Agent Runner** | query() call parameters, session resume, timeout handling | `@anthropic-ai/claude-agent-sdk`'s `query()` | `agent-runner.test.ts`: mock query() → verify session ID passing |
| **Channels** | Message send/receive, formatting, reconnection logic | Third-party SDKs (baileys / grammy) | `whatsapp.test.ts`: mock Baileys → verify sendMessage calls |
| **Config** | YAML loading, priority chain, Zod validation | `fs.readFileSync` (returns fixed YAML) | `config.test.ts`: various YAML inputs → verify merge behavior |
| **TUI** | Ink component rendering | None (Ink provides `render` test utility) | `plan-view.test.tsx`: render → verify output contains step names |

## Mock Patterns

Reference: [nanoclaw](https://github.com/qwibitai/nanoclaw) test practices.

```typescript
// 1. Module-level mock — replace entire external dependency
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(async function* () {
    yield { type: 'text', text: 'step result' };
  }),
}));

// 2. In-memory DB — isolated database per test
let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});
afterEach(() => db.close());

// 3. Fake timers — test timeout and timer logic
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// 4. Config mock — avoid reading real filesystem
vi.mock('./config.js', () => ({
  cueclawHome: () => '/tmp/cueclaw-test',
  loadConfig: () => ({ claude: { api_key: 'test-key', ... } }),
}));
```

## better-sqlite3 Test Strategy

- Uses `better-sqlite3` npm prebuilt binaries — no custom build configuration needed
- All tests use `Database(':memory:')` — no filesystem dependency
- Export `_initTestDatabase()` for test use:

```typescript
// src/db.ts
/** @internal — for tests only */
export function _initTestDatabase(): Database.Database {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}
```

## CI Configuration

```yaml
# .github/workflows/test.yml
name: Test
on:
  pull_request:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
```

## Running Tests

```bash
pnpm test                          # Unit tests (fast, no external deps)
pnpm test:integration              # Integration tests (mock agent runner, in-memory DB)
# Manual validation uses real GitHub API — not automated
```
