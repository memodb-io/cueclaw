# Phase 5: Daemon & Triggers

> **Goal:** Enable workflows to run continuously in the background — a daemon process managed by the OS, with trigger systems (poll/cron) that fire workflow executions automatically, and concurrency control to keep things stable.
>
> **Prerequisites:** Phase 0 (scaffolding) + Phase 1 (Executor, Agent Runner) + Phase 3 or 4 (at least one Channel for notifications)

---

## What Gets Built

By the end of Phase 5:
1. `cueclaw daemon install` registers a system service that auto-starts and restarts on crash
2. Active workflows with poll/cron triggers fire automatically in the background
3. Concurrent workflow executions are managed by GroupQueue with global caps
4. Crash recovery: daemon restarts and resumes in-progress workflows from SQLite state
5. Structured logs capture all background activity

---

## What Already Exists (from Phase 0–4)

- SQLite persistence for workflows, runs, and steps (Phase 0)
- Executor runs workflow steps via Agent Runner (Phase 1)
- Container isolation for secure execution (Phase 2)
- Channels deliver notifications to users (Phase 3–4)
- Config system with logging directory paths (Phase 0)

Phase 5 adds the "always-on" layer — the daemon loop, trigger evaluation, and concurrency control.

---

## Tasks

### 5.1 Daemon Mode (`src/cli.ts` + `src/daemon.ts`)

The daemon is the same Node.js process, started with `cueclaw daemon start` or by the OS service manager. The `startDaemon()` function is defined in `src/daemon.ts` and re-exported from `src/index.ts`.

- [x] `cueclaw daemon start` — start daemon in background (detached, PID file via `spawnDaemonProcess()`)
- [x] `cueclaw daemon start --foreground` — start daemon in foreground (used by launchd/systemd service files)
- [x] `cueclaw daemon stop` — gracefully stop the daemon (via PID file first, falls back to system service)
- [x] `cueclaw daemon restart` — stop + start
- [x] `cueclaw daemon install` — register OS system service (launchd/systemd)
- [x] `cueclaw daemon status` — check if daemon is running (PID file first, then system service)
- [x] `cueclaw daemon uninstall` — remove OS system service
- [x] `cueclaw daemon logs` — tail the daemon log file
- [x] On startup: initialize DB, load config, start all enabled Channels, start trigger loop, write PID file
- [x] On shutdown: graceful — stop accepting new triggers, wait for running steps to complete, disconnect Channels, remove PID file

**PID file management** (`src/daemon.ts`):

```typescript
// PID file at ~/.cueclaw/daemon.pid
export function daemonPidPath(): string       // Returns PID file path
export function writePidFile(pid: number)     // Write PID on startup
export function removePidFile()               // Remove on shutdown
export function readPidFile(): number | null  // Read PID, null if missing
export function isProcessAlive(pid: number)   // process.kill(pid, 0) probe
export function isDaemonRunning(): boolean    // PID file + process probe

export function spawnDaemonProcess(): number | null
// Spawns detached child process with:
// - process.execArgv forwarding (preserves tsx/loader flags in dev mode)
// - stdio redirected to ~/.cueclaw/logs/daemon.log
// - PID file written on spawn
// - Returns child PID, or null on failure
```

`startDaemon()` writes PID file on start, removes it on graceful shutdown (SIGTERM/SIGINT).

**CLI change:** `bot start` subcommand removed from CLI — now only available as TUI `/bot start` slash command.

### 5.2 System Service Integration (`src/service.ts`)

PID file management in `daemon.ts` for background process tracking. OS service managers (launchd/systemd) additionally manage the daemon when installed.

**macOS (launchd):**

- [x] `cueclaw daemon install` generates `~/Library/LaunchAgents/com.cueclaw.plist` and runs `launchctl load`
- [x] `cueclaw daemon uninstall` runs `launchctl unload` and deletes the plist
- [x] `cueclaw daemon restart` — stop + start (use `launchctl kickstart -k` manually if needed)
- [x] `KeepAlive: true` for automatic crash restart
- [x] Stdout/stderr redirect to `~/.cueclaw/logs/daemon.log`

```xml
<!-- launchd/com.cueclaw.plist -->
<!-- IMPORTANT: The plist generator must expand ~ to process.env.HOME at generation time.
     launchd does NOT expand ~ in StandardOutPath/StandardErrorPath. -->
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key><string>com.cueclaw</string>
  <key>ProgramArguments</key>
  <array>
    <string>/path/to/node</string>
    <string>/path/to/cueclaw/dist/cli.js</string>
    <string>daemon</string>
    <string>start</string>
    <string>--foreground</string>
  </array>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/username/.cueclaw/logs/daemon.log</string>
  <key>StandardErrorPath</key><string>/Users/username/.cueclaw/logs/daemon.log</string>
</dict>
</plist>
```

**Linux (systemd):**

- [x] `cueclaw daemon install` generates `~/.config/systemd/user/cueclaw.service`, runs `systemctl --user enable --now cueclaw`
- [x] `cueclaw daemon uninstall` runs `systemctl --user disable --now cueclaw` and deletes the service file
- [x] `Restart=always` for automatic crash restart
- [x] Logs accessible via `journalctl --user -u cueclaw`

### 5.3 Trigger System (`src/trigger.ts`)

Triggers are generic — they don't know about specific services. The Planner generates the trigger logic (e.g., `gh api` scripts).

- [x] `TriggerConfig` type handling for MVP trigger types: `poll`, `cron`, `manual`
- [x] `evaluateTrigger(workflow, db)` — check if a trigger should fire
- [x] Poll trigger: execute `check_script`, compare output to last stored result
- [x] Cron trigger: evaluate cron expression against current time
- [x] Manual trigger: immediate execution on user request

**Poll trigger execution flow:**

```typescript
async function evaluatePollTrigger(
  workflow: Workflow,
  trigger: PollTriggerConfig,
  db: Database
): Promise<TriggerResult | null> {
  // 1. Execute check_script with timeout (default 30s)
  const CHECK_SCRIPT_TIMEOUT = 30_000
  const { stdout } = await execScript(trigger.check_script, {
    signal: AbortSignal.timeout(CHECK_SCRIPT_TIMEOUT),
  })

  // 2. Load last result from trigger_state table
  const lastResult = db.prepare(
    'SELECT last_result FROM trigger_state WHERE workflow_id = ?'
  ).get(workflow.id)

  // 3. Compare based on diff_mode
  let triggerData: string | null = null

  if (trigger.diff_mode === 'new_items') {
    const newItems = diffNewItems(lastResult?.last_result, stdout)
    if (newItems.length > 0) triggerData = newItems.join('\n')
  } else {
    if (lastResult?.last_result !== stdout) triggerData = stdout
  }

  // 4. Save current result
  db.prepare(
    'INSERT OR REPLACE INTO trigger_state (workflow_id, last_result, last_check_at) VALUES (?, ?, ?)'
  ).run(workflow.id, stdout, new Date().toISOString())

  if (!triggerData) return null
  return { workflowId: workflow.id, data: triggerData }
}
```

### 5.4 Trigger Loop (`src/trigger-loop.ts`)

The main polling loop that evaluates all active triggers on schedule.

- [x] On start: load all workflows with `phase === 'active'` from SQLite
- [x] Maintain a timer map: each workflow's trigger gets its own interval
- [x] Poll triggers: execute every `interval_seconds`
- [x] Cron triggers: evaluate every minute, fire when expression matches
- [x] When a workflow is created/paused/deleted: dynamically add/remove from the loop
- [x] Error handling: if a trigger check fails, log error, continue to next cycle (don't crash the loop)

```typescript
export class TriggerLoop {
  private intervals = new Map<string, NodeJS.Timeout>()

  async start(): Promise<void> {
    const activeWorkflows = this.db.prepare(
      "SELECT * FROM workflows WHERE phase = 'active'"
    ).all() as Workflow[]

    for (const wf of activeWorkflows) {
      this.registerTrigger(wf)
    }
  }

  registerTrigger(workflow: Workflow): void {
    const trigger = JSON.parse(workflow.trigger_json) as TriggerConfig

    if (trigger.type === 'poll') {
      const interval = setInterval(
        () => this.checkPollTrigger(workflow, trigger),
        trigger.interval_seconds * 1000
      )
      this.intervals.set(workflow.id, interval)
    }

    if (trigger.type === 'cron') {
      // Evaluate every 60s, fire when cron expression matches current minute
      // Deduplication: track last_fire_at in trigger_state to prevent double-fire
      // on daemon restart or slow evaluation cycles.
      // last_fire_at stores prev.toISOString() (the cron match time, not current time).
      // last_check_at is used by poll triggers only.
      const interval = setInterval(() => {
        try {
          const expr = parseExpression(trigger.expression, {
            tz: trigger.timezone ?? 'UTC',
          })
          const prev = expr.prev().toDate()
          const now = new Date()
          // Fire if the previous match time is within the last 60s (i.e., current minute matches)
          if (now.getTime() - prev.getTime() < 60_000) {
            // Dedup check: skip if we already fired for this cron match
            const state = this.db.prepare(
              'SELECT last_fire_at FROM trigger_state WHERE workflow_id = ?'
            ).get(workflow.id) as { last_fire_at: string } | undefined
            const lastFire = state?.last_fire_at ? new Date(state.last_fire_at).getTime() : 0
            if (prev.getTime() <= lastFire) return  // Already fired for this slot

            this.db.prepare(
              'INSERT OR REPLACE INTO trigger_state (workflow_id, last_fire_at) VALUES (?, ?)'
            ).run(workflow.id, prev.toISOString())

            this.executeTrigger(workflow, new Date().toISOString())
          }
        } catch (err) {
          this.logger.error({ workflowId: workflow.id, err }, 'Cron evaluation failed')
        }
      }, 60_000)
      this.intervals.set(workflow.id, interval)
    }
  }

  stop(): void {
    for (const interval of this.intervals.values()) {
      clearInterval(interval)
    }
    this.intervals.clear()
  }
}
```

### 5.5 Concurrency Control (`src/group-queue.ts`)

Prevents resource exhaustion from too many concurrent agent executions. MVP uses a simple FIFO + concurrency cap — no round-robin.

- [x] Global concurrency cap: `MAX_CONCURRENT_AGENTS = 5` (configurable)
- [x] Per-workflow queue: same workflow's multiple trigger fires queue up sequentially (FIFO)
- [x] Graceful shutdown: don't kill running agents, let them finish naturally

```typescript
export class GroupQueue {
  private running = 0
  private runningByWorkflow = new Set<string>()  // Track which workflows have active tasks
  private queue: Array<{ workflowId: string; task: () => Promise<void> }> = []

  constructor(private maxConcurrent = 5) {}

  async enqueue(workflowId: string, task: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const wrappedTask = async () => {
        try { await task(); resolve() }
        catch (e) { reject(e) }
      }

      // Queue if at global cap OR if this workflow already has a running task
      if (this.running >= this.maxConcurrent || this.runningByWorkflow.has(workflowId)) {
        this.queue.push({ workflowId, task: wrappedTask })
      } else {
        this.running++
        this.runningByWorkflow.add(workflowId)
        wrappedTask().finally(() => {
          this.running--
          this.runningByWorkflow.delete(workflowId)
          this.processNext()
        })
      }
    })
  }

  private processNext(): void {
    // Find next task whose workflow is not currently running
    const idx = this.queue.findIndex(item => !this.runningByWorkflow.has(item.workflowId))
    if (idx === -1) return
    const next = this.queue.splice(idx, 1)[0]
    this.running++
    this.runningByWorkflow.add(next.workflowId)
    next.task().finally(() => {
      this.running--
      this.runningByWorkflow.delete(next.workflowId)
      this.processNext()
    })
  }
}
```

### 5.6 Crash Recovery

- [x] On daemon restart: query SQLite for workflows with `phase = 'executing'` and runs with `status = 'running'`
- [x] For interrupted runs: mark as `failed` with error "Daemon restarted during execution"
- [x] Re-register all active triggers in the TriggerLoop
- [x] Notify users about interrupted runs via their Channels

```typescript
async function recoverRunningWorkflows(db: Database, router: MessageRouter) {
  const interruptedRuns = db.prepare(
    "SELECT * FROM workflow_runs WHERE status = 'running'"
  ).all()

  for (const run of interruptedRuns) {
    db.prepare(
      "UPDATE workflow_runs SET status = 'failed', error = ? WHERE id = ?"
    ).run('Daemon restarted during execution', run.id)

    // Notify user via all connected Channels
    await router.broadcastNotification(
      `Workflow ${run.workflow_id} was interrupted by daemon restart (run ${run.id})`
    )
  }
}
```

### 5.7 Logging System

- [x] Daemon log: `~/.cueclaw/logs/daemon.log` — main process events, trigger evaluations, errors
- [ ] ~~Execution logs: `~/.cueclaw/logs/executions/{workflow_id}_{date}.log`~~ — NOT IMPLEMENTED (all logging goes to daemon.log)
- [ ] ~~Log rotation~~ — NOT IMPLEMENTED
- [x] `cueclaw daemon logs` tails the daemon log with `pino-pretty` formatting
- [x] Child loggers with context: `logger.child({ workflowId, runId, stepId })`

### 5.8 Workflow State Persistence

- [x] All state transitions write to SQLite immediately (not batched)
- [x] Step outputs saved to `step_runs.output_json` after each step completes
- [x] Workflow phase transitions logged with timestamps
- [x] Session IDs stored for potential resume after crash (best-effort, not guaranteed)

---

## Trigger Types Summary

| Trigger | How It Works | Example |
|---------|-------------|---------|
| **poll** | Daemon executes `check_script` at `interval_seconds`, diffs output against last result | `gh api repos/.../issues --jq '...'` every 60s |
| **cron** | Evaluated every 60s, fires when expression matches current time | `0 9 * * *` — every day at 9am |
| **manual** | User triggers via TUI or Bot | `/run wf_abc123` or clicking "Run" in Dashboard |

> **webhook**: Not in MVP. Future enhancement — HTTP server + GitHub webhook integration.

### 5.9 `ask_user` Failure Policy in Daemon Mode

When `on_step_failure: 'ask_user'` triggers during unattended daemon execution:

1. Executor calls the `onStepFailure()` callback with failure details
2. Callback returns user's choice: `'retry'` / `'skip'` / `'stop'`
3. ~~Timeout mechanism~~ — NOT IMPLEMENTED (waits indefinitely for callback response)

**Future enhancement:** Add configurable `ask_user_timeout` (e.g., 1 hour) that falls back to `stop` behavior if no user response.

```typescript
// Current implementation in executor.ts — no timeout
const decision = await onStepFailure(step, error)
// decision: 'retry' | 'skip' | 'stop'
```

---

## Acceptance Criteria

- [x] `cueclaw daemon install` creates launchd plist (macOS) or systemd service (Linux)
- [x] Daemon starts automatically on system boot and restarts after crash
- [x] `cueclaw daemon status` correctly reports running/stopped state
- [x] `cueclaw daemon logs` shows formatted log output
- [x] Poll trigger correctly executes `check_script` and detects new items
- [x] Cron trigger fires at the configured schedule
- [x] GroupQueue limits concurrent agent executions to the configured cap
- [x] Per-workflow queueing prevents concurrent runs of the same workflow
- [x] Crash recovery marks interrupted runs as failed and notifies users
- [x] All active triggers re-register after daemon restart
- [x] ~~Execution logs are written to per-run log files~~ — NOT IMPLEMENTED (all logging goes to daemon.log)
- [x] Graceful shutdown waits for running agents to complete

---

## Dependencies to Install

```bash
pnpm add cron-parser  # For cron expression evaluation
```

---

## What This Unlocks

Phase 5 makes CueClaw a truly "always-on" system:
- **Phase 6** can now validate workflows running continuously in the background
- Workflows survive system restarts and daemon crashes
- Multiple workflows run concurrently without resource exhaustion
