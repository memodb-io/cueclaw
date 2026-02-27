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
| **Agent Runner** | query() call parameters, session resume, timeout handling | `@anthropic-ai/claude-agent-sdk`'s `query()` | Covered by `executor.test.ts` and `integration.test.ts` (agent-runner module-mocked) |
| **Channels** | Message send/receive, formatting, reconnection logic | Third-party SDKs (baileys / grammy) | `telegram.test.ts`: mock grammy → verify sendMessage, inline keyboards |
| **Config** | YAML loading, priority chain, Zod validation | `fs.readFileSync` (returns fixed YAML) | `config.test.ts`: various YAML inputs → verify merge behavior |
| **TUI** | Ink component rendering, slash commands | `ink-testing-library` render utility | `chat.test.tsx`, `renderers.test.tsx`, `commands.test.ts` |
| **Planner Session** | Multi-turn conversation, tool responses | Anthropic SDK `client.messages.create` | `planner-session.test.ts`: ask_question/set_secret/create_workflow flows |

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

## TUI Component Testing

TUI components use `ink-testing-library` for isolated rendering:

```typescript
import { render } from 'ink-testing-library'

// Render component and assert output
const { lastFrame } = render(<WorkflowTable workflows={mockWorkflows} />)
expect(lastFrame()).toContain('my-workflow')

// Chat component with command autocomplete
const { lastFrame } = render(
  <Chat messages={[]} isGenerating={false} onSubmit={vi.fn()} />
)
expect(lastFrame()).toContain('Describe a workflow')
```

### Slash Command Tests

Commands are tested by creating a mock `CommandContext` and calling `execute()` directly:

```typescript
const messages: ChatMessage[] = []
const ctx: CommandContext = {
  db: _initTestDatabase(),
  config: mockConfig,
  cwd: '/tmp',
  bridge: null,
  addMessage: (msg) => messages.push(msg),
  clearMessages: () => messages.length = 0,
  setConfig: vi.fn(),
}

findCommand('help')!.execute('', ctx)
expect(messages[0].text).toContain('Available commands')
```

### Planner Session Tests

Multi-turn sessions are tested by mocking the Anthropic API to return specific tool_use responses:

```typescript
vi.mock('./anthropic-client.js', () => ({
  createAnthropicClient: () => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', name: 'ask_question', input: { question: '...' } }],
      }),
    },
  }),
}))
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

Single workflow (`.github/workflows/ci.yml`) runs on push to `main` and all PRs:

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm test
  lint:
    runs-on: ubuntu-latest
    steps: ...  # eslint
  typecheck:
    runs-on: ubuntu-latest
    steps: ...  # tsc --noEmit
  changeset:
    if: github.event_name == 'pull_request'
    steps: ...  # warn if changeset missing
  release:
    if: github.ref == 'refs/heads/main'
    needs: [test, lint, typecheck]
    steps: ...  # changesets publish with provenance
```

## Running Tests

```bash
pnpm test                          # All tests (fast, no external deps, in-memory DB)
pnpm test:watch                    # Watch mode for development
# Manual validation uses real GitHub API — not automated
```

## Test Files

23 test files covering ~188 tests:

```
src/
├── config.test.ts               # Config loading, YAML parsing
├── db.test.ts                   # SQLite CRUD, migrations
├── env.test.ts                  # .env parsing, writeEnvVar, credential detection
├── executor.test.ts             # DAG scheduling, parallel execution, failure policy
├── group-queue.test.ts          # Concurrency control
├── hooks.test.ts                # PreToolUse, PreCompact hooks
├── integration.test.ts          # End-to-end workflow flows
├── ipc.test.ts                  # Host ↔ container IPC
├── mcp-server.test.ts           # MCP server tools
├── mount-security.test.ts       # Mount allowlist validation
├── planner.test.ts              # Planner output parsing, DAG validation
├── planner-session.test.ts      # Multi-turn conversation, tool responses
├── router.test.ts               # Message routing
├── session.test.ts              # Session resume, compaction
├── setup-environment.test.ts    # Environment detection
├── trigger.test.ts              # Trigger evaluation
├── types.test.ts                # Type validation
├── workflow.test.ts             # Workflow state machine
├── container-runner.test.ts     # Container spawn
├── channels/
│   └── telegram.test.ts         # Telegram channel
└── tui/
    ├── chat.test.tsx            # Chat component rendering, command hints
    ├── commands.test.ts         # Slash command parsing and execution
    └── renderers.test.tsx       # WorkflowTable, WorkflowDetail components
```
