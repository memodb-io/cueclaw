# Core Type Definitions

## Workflow Protocol v1

One JSON serves execution engine, user confirmation, UI rendering, and remote viewing simultaneously.

**Design references:**

| Source | What We Borrow |
|--------|----------------|
| **Argo Workflows** | `depends_on` explicit DAG dependency declaration |
| **n8n** | Node-embedded `position` layout info; same JSON serves both engine and UI |
| **LangGraph** | `phase` lifecycle state machine with human-in-the-loop `interrupt` |
| **GitHub Actions** | `trigger.on` event trigger vocabulary (widely present in LLM training data) |
| **CrewAI** | `description` + `expected_output` as LLM-generatable step semantics |

### PlannerOutput vs Workflow

The LLM only generates `PlannerOutput` (name, description, trigger, steps, failure_policy). The framework fills in the remaining `Workflow` fields (id, phase, schema_version, timestamps). The tool_use `input_schema` only describes `PlannerOutput`.

```typescript
/** LLM-generated portion — used as tool_use input_schema */
interface PlannerOutput {
  name: string
  description: string           // User's original natural language description
  trigger: TriggerConfig
  steps: PlanStep[]             // Planner-generated execution steps (DAG)
  failure_policy: FailurePolicy
}

/** Complete type after framework fills remaining fields */
interface Workflow extends PlannerOutput {
  schema_version: '1.0'
  id: string                    // Framework generates: wf_ + nanoid
  phase: WorkflowPhase
  created_at: string            // ISO 8601
  updated_at: string
  metadata?: Record<string, any>
}

type WorkflowPhase =
  | 'planning'
  | 'awaiting_confirmation'
  | 'active'                    // Confirmed, triggers registered, waiting for trigger to fire
  | 'executing'                 // A run is currently in progress
  | 'paused'
  | 'completed'
  | 'failed'

/** Execution record for a workflow run */
interface WorkflowRun {
  id: string                    // run_ + nanoid
  workflow_id: string
  trigger_data: string | null
  status: 'running' | 'completed' | 'failed'
  started_at: string            // ISO 8601
  completed_at?: string
  error?: string
  duration_ms?: number
}

/** Execution record for a single step within a run */
interface StepRun {
  id: string                    // sr_ + nanoid
  run_id: string
  step_id: string
  status: StepStatus
  output_json?: string
  error?: string
  started_at?: string
  completed_at?: string
  duration_ms?: number
}

/** Definition fields only — LLM generates these, no runtime state.
 *  Runtime status/output/error are tracked in StepRun (see above). */
interface PlanStep {
  id: string                    // kebab-case, e.g. "fetch-issues"
  description: string           // Human-readable step description
  expected_output?: string
  agent: 'claude'               // Fixed to Claude Agent SDK
  inputs: Record<string, any>   // Supports $steps.{id}.output and $trigger_data references
  depends_on: string[]          // DAG dependencies
  position?: { x: number; y: number }  // Auto-calculated by framework, not LLM
}

type StepStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'

interface FailurePolicy {
  on_step_failure: 'stop' | 'skip_dependents' | 'ask_user'
  max_retries: number           // Default 0
  retry_delay_ms: number        // Default 5000, exponential backoff ×2
}
```

**`on_step_failure` behavior:**

| Policy | Behavior |
|--------|----------|
| `stop` | Halt the entire run immediately. No further steps execute. |
| `skip_dependents` | The failed step is marked `failed`. All steps that transitively depend on it (via `depends_on`) are automatically marked `skipped`. Independent steps continue executing normally. |
| `ask_user` | Pause execution and notify the user via connected channels. Wait for user decision (retry/skip/abort). |

**`skip_dependents` example:**

```
Step A (failed)
  ├── Step B (depends_on: [A]) → skipped
  │   └── Step D (depends_on: [B]) → skipped (transitive)
  └── Step C (depends_on: []) → runs normally (independent)
```

When the executor finds ready steps, it checks each step's `depends_on` list. If any dependency has status `failed` or `skipped`, the step is automatically skipped. This propagates transitively through the DAG.

```typescript

type TriggerConfig =
  | { type: 'poll'; interval_seconds: number; check_script: string; diff_mode: 'new_items' | 'any_change' }
  | { type: 'cron'; expression: string; timezone?: string }
  | { type: 'manual' }
  // webhook: future — not in MVP
```

### WorkflowPhase State Transitions

Valid transitions, what triggers each, and who is responsible:

| From | To | Trigger | Owner |
|------|----|---------|-------|
| `planning` | `awaiting_confirmation` | Planner generates valid plan | Planner |
| `awaiting_confirmation` | `active` | User confirms plan (poll/cron trigger) | Confirmation flow |
| `awaiting_confirmation` | `executing` | User confirms plan (manual trigger) | Confirmation flow |
| `awaiting_confirmation` | `planning` | User requests modification | Confirmation flow |
| `active` | `executing` | Trigger fires, starting a new run | TriggerLoop |
| `executing` | `active` | Run completes (poll/cron trigger — returns to monitoring) | Executor |
| `executing` | `completed` | Run completes (manual trigger — no more runs expected) | Executor |
| `executing` | `failed` | Step fails + policy = `stop` (manual trigger) | Executor |
| `executing` | `active` | Step fails (poll/cron trigger — single run fails, workflow stays active for next trigger) | Executor |
| `active` | `paused` | User pauses workflow | User action (CLI/TUI/Bot) |
| `executing` | `paused` | User pauses running workflow | User action (CLI/TUI/Bot) |
| `paused` | `active` | User resumes workflow (re-registers triggers) | User action (CLI/TUI/Bot) |
| `failed` | `executing` | User manually retries | User action (re-enters from failed step) |

**Key distinction:**
- `active` = workflow is confirmed, triggers are registered, waiting for next trigger fire
- `executing` = a run is currently in progress

Invalid transitions (no other transitions are allowed):
- `completed` → any (terminal state; create a new run instead)
- `executing` → `planning` (cannot go back to planning during execution)
- `paused` → `planning` (must resume first, then modify)

### `Workflow.phase` vs `WorkflowRun.status`

These are two distinct lifecycle dimensions:

- **`Workflow.phase`** is the overall workflow lifecycle (`active` = triggers are registered and monitoring). A workflow with `phase = 'active'` may have many completed, failed, or running `WorkflowRun` records.
- **`WorkflowRun.status`** is the state of a single execution run (`running` / `completed` / `failed`).

**A single run failing does NOT change the workflow phase** for poll/cron-triggered workflows. The trigger continues monitoring, and the next trigger fire creates a new run. Only user actions (pause/delete) change the workflow phase.

For `manual` trigger workflows, a completed/failed run directly transitions the workflow to `completed`/`failed` since there is no ongoing trigger to return to.

### Input Reference Mechanism

Two reference syntaxes:
- `$steps.{id}.output` — references a preceding step's output
- `$trigger_data` — references the trigger's payload data (poll diff results, cron fire time, etc.)

Rules:
- Both are resolved **lazily at execution time**, not during plan generation
- `$steps` references must point to a step listed in `depends_on` (validated at Planner compile-time)
- `$trigger_data` is allowed for all trigger types: poll/cron provide automatic data, manual triggers resolve to `null` unless user provides runtime arguments (e.g., `cueclaw run wf_id --data "..."`)
- Truncation: outputs exceeding 10KB are truncated with `[truncated]` marker
- If referenced step is `failed`/`skipped` → output is null → referencing step gets skipped (controlled by failure_policy)
- No nested references (e.g., `$steps.a.output.someField`) — only top-level output string

**Why string-only?** Nested field access (`$steps.a.output.someField`) would require the framework to parse step outputs as structured data (JSON), handle parse failures, and validate field paths — all adding complexity with minimal benefit. Since each step is executed by an LLM agent, the agent can interpret a JSON string in its input just as well as a pre-extracted field. The framework stays simple; the agent handles structure.

**Workaround:** If a step needs to pass structured data to dependents, have the agent output a JSON string. The downstream step's agent will parse and extract the relevant fields naturally. For example:
- Step A outputs: `{"branch": "feature/42", "repo_path": "/tmp/repo"}`
- Step B's input: `{ "context": "$steps.step-a.output" }` — the agent receives the full JSON string and extracts what it needs

### `position` Auto-Layout

- LLM does NOT generate position — framework auto-calculates via Sugiyama layered layout algorithm
- Use `dagre` ([npmjs.com/package/dagre](https://www.npmjs.com/package/dagre)) or `elkjs` ([npmjs.com/package/elkjs](https://www.npmjs.com/package/elkjs)) for layout computation — no custom implementation needed
- Framework injects position before storing in SQLite / returning to UI

## Session Type

Per-step session for agent execution and resume:

```typescript
interface Session {
  id: string                      // Unique session ID
  step_run_id: string             // Bound to a specific step run
  sdk_session_id?: string         // Claude Agent SDK session ID for resume
  created_at: string              // ISO 8601
  last_used_at: string            // ISO 8601
  is_active: boolean              // false after step completes or fails
}
```

## Planner Session Types

Multi-turn conversation types for iterative workflow creation (`src/planner-session.ts`):

```typescript
interface PlannerSession {
  id: string                        // ps_ + nanoid
  messages: Anthropic.MessageParam[] // Full conversation history
  status: 'conversing' | 'plan_ready' | 'cancelled'
  workflow: Workflow | null          // Set when status = 'plan_ready'
}

interface PlannerTurn {
  type: 'question' | 'plan' | 'text' | 'error'
  content: string                   // Question text, plan summary, or error message
  workflow?: Workflow               // Present when type = 'plan'
}

interface StreamCallbacks {
  onToken?: (token: string) => void // Called for each streaming token
}
```

### Planner Tools

The multi-turn planner uses three tools:

| Tool | Purpose | When Used |
|------|---------|-----------|
| `ask_question` | Ask user for clarification | Vague/ambiguous requests, missing credentials |
| `set_secret` | Store a credential (env var) | User provides API token, webhook URL, etc. |
| `create_workflow` | Generate final `PlannerOutput` | Requirements are clear, ready to plan |

`set_secret` auto-continues: after storing the credential, the planner recursively runs another turn (may ask more questions or create the workflow).

## TUI Types

### Chat Message

```typescript
/** Discriminated union by `type` field (not `role`) */
type ChatMessage =
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'assistant-jsx'; content: React.ReactNode }  // Rich content (e.g., WorkflowTable)
  | { type: 'system'; text: string }
  | { type: 'error'; text: string }
  | { type: 'warning'; text: string }
  | { type: 'plan-ready'; workflowName: string }
```

Defined in `src/tui/ui-state-context.ts`.

### Slash Commands

```typescript
/** Defined in src/tui/commands/types.ts */
interface CommandContext {
  db: Database.Database
  config: CueclawConfig | null
  cwd: string
  bridge: DaemonBridge | null
  addMessage: (msg: ChatMessage) => void
  clearMessages: () => void
  setConfig: (config: CueclawConfig) => void
  setThemeVersion: (fn: (v: number) => number) => void  // Triggers re-render on theme change
}

interface SlashCommand {
  name: string                      // Primary command name (e.g., 'list')
  aliases: string[]                 // Alternative names (e.g., ['ls'])
  description: string
  usage: string                     // Usage string (e.g., '/list')
  completion?: string[]             // Subcommand completion list (e.g., ['start', 'status'] for /bot)
  execute: (args: string, ctx: CommandContext) => Promise<void> | void
}
```

Commands are registered individually in `src/tui/commands/` via `registerCommand()` and discovered via `findCommand()` / `getCommands()`.

### Daemon Bridge

```typescript
interface DaemonBridge {
  triggerLoop: TriggerLoop | null   // null when isExternal
  router: MessageRouter | null      // null when isExternal
  botChannels: Channel[]            // Connected bot channels
  isExternal: boolean               // true = system service running
}

interface InitDaemonBridgeOptions {
  skipBots?: boolean                // Skip bot channel initialization
}
```

## Channel Context

```typescript
/** Identifies the channel and sender for context-aware behavior (e.g., planner system prompt) */
interface ChannelContext {
  channel: 'tui' | 'telegram' | 'whatsapp'
  chatJid?: string   // bot channels only
  sender?: string    // bot channels only
}
```

`ChannelContext` is threaded through `PlannerSession`, `generatePlan`, `modifyPlan`, and `MessageRouter` so the planner can adapt its system prompt:
- **Bot channels**: planner knows the chat ID and can generate workflows that notify the user directly
- **TUI**: planner requires explicit recipient input for notifications

## Channel Interface

```typescript
/** Channel interface for TUI, WhatsApp, Telegram.
 *  OnInboundMessage is provided at construction time (constructor parameter),
 *  not via an interface method — each Channel implementation accepts it
 *  in its constructor and calls it when new messages arrive. */
interface Channel {
  name: string
  connect(): Promise<void>
  sendMessage(jid: string, text: string): Promise<string>   // Returns a message ID for edit support
  editMessage?(jid: string, messageId: string, text: string): Promise<void>  // In-place message editing
  sendConfirmation(jid: string, workflow: Workflow): Promise<void>  // Plan confirmation (each channel renders differently)
  isConnected(): boolean
  ownsJid(jid: string): boolean
  disconnect(): Promise<void>
  setTyping?(jid: string, isTyping: boolean): Promise<void>
}

interface NewMessage {
  text: string
  sender: string                // Sender ID (platform-specific)
  timestamp?: string            // ISO 8601
  replyTo?: string              // Message ID being replied to (used in confirmation flow)
  metadata?: Record<string, any>
}

type OnInboundMessage = (chatJid: string, message: NewMessage) => void
```

TUI also implements the Channel interface, with `jid` set to a fixed value like `"local"`. TUI's `sendMessage` returns `''` (no meaningful ID). Bot channels return platform message IDs (Telegram `message_id`, WhatsApp `key.id`).

`editMessage()` enables in-place status updates in the router — e.g., "Generating execution plan..." is edited to "✅ Execution plan generated." on success. Falls back to `sendMessage` when `editMessage` is not available.

`sendConfirmation()` is implemented by each Channel with its own rendering:
- **TUI**: Plan view component + keyboard shortcuts (Y/M/N)
- **Telegram**: Inline keyboard buttons
- **WhatsApp**: Text reply (yes/no/modify)

## Error Hierarchy

```typescript
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

## CueClaw MCP Server Tools

Injected into the agent execution environment so agents can call host-side functions:

- `cueclaw_report_progress` — Report step execution progress
- `cueclaw_notify` — Send notifications to user (via all connected Channels)
- `cueclaw_get_context` — Read results from preceding steps
- `cueclaw_create_subtask` — Dynamically create sub-tasks within a workflow

## IPC Mechanism (Host ↔ Container)

File-polling IPC (per-step isolation — each step gets its own IPC directory):
```
~/.cueclaw/ipc/{workflow_id}/{step_id}/
├── input/                    # Host → Container (user appended instructions)
│   └── {timestamp}.json
├── output/                   # Container → Host (progress/notifications)
│   └── {timestamp}.json
└── _close                    # Sentinel file to signal container shutdown
```

## Container & Mount Types

```typescript
/** Additional host directory to mount into the container */
interface AdditionalMount {
  hostPath: string              // ~ expands to home directory
  containerPath?: string        // Default: same as hostPath under /workspace/mounts/
  readonly?: boolean            // Default: true
}

/** Controls which host directories can be mounted into containers */
interface MountAllowlist {
  allowedRoots: AllowedRoot[]
  blockedPatterns: string[]     // e.g. [".ssh", ".gnupg", ".aws", ".env", "credentials"]
  nonMainReadOnly: boolean      // Force read-only for non-primary workflows
}

interface AllowedRoot {
  path: string
  allowReadWrite: boolean
  description?: string
}

/** Per-workflow container configuration */
interface ContainerConfig {
  additionalMounts?: AdditionalMount[]
  timeout?: number              // Default: 1800000 (30 min)
}
```

Mount allowlist stored at `~/.cueclaw/mount-allowlist.json`. See Phase 2 for implementation details.

## Database Schema (SQLite)

All state persisted to `~/.cueclaw/db/cueclaw.db` (`better-sqlite3`):

```sql
CREATE TABLE workflows (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  trigger_json  TEXT NOT NULL,
  steps_json    TEXT NOT NULL,
  failure_policy_json TEXT NOT NULL,
  phase         TEXT NOT NULL DEFAULT 'planning',
  schema_version TEXT NOT NULL DEFAULT '1.0',
  metadata_json TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE workflow_runs (
  id            TEXT PRIMARY KEY,
  workflow_id   TEXT NOT NULL REFERENCES workflows(id),
  trigger_data  TEXT,
  status        TEXT NOT NULL DEFAULT 'running',
  started_at    TEXT NOT NULL,
  completed_at  TEXT,
  error         TEXT,
  duration_ms   INTEGER
);

CREATE TABLE step_runs (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES workflow_runs(id),
  step_id       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  output_json   TEXT,
  error         TEXT,
  started_at    TEXT,
  completed_at  TEXT,
  duration_ms   INTEGER
);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  step_run_id   TEXT NOT NULL REFERENCES step_runs(id),  -- per-step session, not per-run
  sdk_session_id TEXT,                                    -- Claude Agent SDK session ID for resume
  created_at    TEXT NOT NULL,
  last_used_at  TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1
);
```

**Session resume constraints:**

- Sessions are **per-step**, not per-run — each step gets its own isolated session to prevent context pollution
- Session resume is only supported for **retrying the same step** (same `step_run_id`), never across different steps
- Data passes between steps via `$steps.{id}.output` references, not shared session context
- Resume is best-effort: if the SDK session has expired or been compacted, the step runs fresh

```sql

CREATE TABLE trigger_state (
  workflow_id   TEXT PRIMARY KEY REFERENCES workflows(id),
  last_result   TEXT,
  last_check_at TEXT,
  last_fire_at  TEXT,              -- Last cron fire time (ISO 8601), used for cron dedup
  last_error    TEXT
);
```

```sql
-- Performance indexes for common queries
CREATE INDEX idx_workflows_phase ON workflows(phase);
CREATE INDEX idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX idx_workflow_runs_workflow_id ON workflow_runs(workflow_id);
CREATE INDEX idx_step_runs_run_id ON step_runs(run_id);
CREATE INDEX idx_step_runs_step_run ON step_runs(step_id, run_id);
CREATE INDEX idx_sessions_step_run_id ON sessions(step_run_id);
```

**Migration strategy:** Inline migrations — check table existence at startup, use `ALTER TABLE` for incremental field additions. WAL mode for concurrent read performance.
