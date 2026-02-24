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

### 5.1 Daemon Mode (`src/cli.ts` + `src/index.ts`)

The daemon is the same Node.js process, started with `cueclaw daemon start` or by the OS service manager.

- [ ] `cueclaw daemon start [--detach]` — start the daemon process (foreground for debugging, or `--detach` for background)
- [ ] `cueclaw daemon stop` — gracefully stop the daemon
- [ ] `cueclaw daemon restart` — stop + start
- [ ] `cueclaw daemon install` — register OS system service (launchd/systemd)
- [ ] `cueclaw daemon uninstall` — remove OS system service
- [ ] `cueclaw daemon status` — check if daemon is running
- [ ] `cueclaw daemon logs` — tail the daemon log file
- [ ] On startup: initialize DB, load config, start all enabled Channels, start trigger loop
- [ ] On shutdown: graceful — stop accepting new triggers, wait for running steps to complete, disconnect Channels

```typescript
// src/index.ts — daemon main loop
export async function startDaemon(config: CueclawConfig) {
  const db = initDb()
  const router = new MessageRouter()

  // Start enabled channels
  if (config.whatsapp?.enabled) {
    const wa = new WhatsAppChannel(config.whatsapp, (jid, msg) =>
      router.handleInbound('whatsapp', jid, msg)
    )
    await wa.connect()
    router.registerChannel(wa)
  }
  // ... telegram, tui channels

  // Crash recovery — must run BEFORE trigger loop to clean up stale state
  await recoverRunningWorkflows(db, router)

  // Start trigger loop (queries for phase='active' workflows)
  const triggerLoop = new TriggerLoop(db, router, config)
  await triggerLoop.start()

  // Graceful shutdown
  process.on('SIGTERM', () => triggerLoop.stop())
  process.on('SIGINT', () => triggerLoop.stop())
}
```

### 5.2 System Service Integration (`src/service.ts`)

No custom PID file management — delegate to OS-level service managers.

**macOS (launchd):**

- [ ] `cueclaw daemon install` generates `~/Library/LaunchAgents/com.cueclaw.plist` and runs `launchctl load`
- [ ] `cueclaw daemon uninstall` runs `launchctl unload` and deletes the plist
- [ ] `cueclaw daemon restart` uses `launchctl kickstart -k`
- [ ] `KeepAlive: true` for automatic crash restart
- [ ] Stdout/stderr redirect to `~/.cueclaw/logs/daemon.log`

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
  </array>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/username/.cueclaw/logs/daemon.log</string>
  <key>StandardErrorPath</key><string>/Users/username/.cueclaw/logs/daemon.log</string>
</dict>
</plist>
```

**Linux (systemd):**

- [ ] `cueclaw daemon install` generates `~/.config/systemd/user/cueclaw.service`, runs `systemctl --user enable --now cueclaw`
- [ ] `cueclaw daemon uninstall` runs `systemctl --user disable --now cueclaw` and deletes the service file
- [ ] `Restart=always` for automatic crash restart
- [ ] Logs accessible via `journalctl --user -u cueclaw`

### 5.3 Trigger System (`src/trigger.ts`)

Triggers are generic — they don't know about specific services. The Planner generates the trigger logic (e.g., `gh api` scripts).

- [ ] `TriggerConfig` type handling for MVP trigger types: `poll`, `cron`, `manual`
- [ ] `evaluateTrigger(workflow, db)` — check if a trigger should fire
- [ ] Poll trigger: execute `check_script`, compare output to last stored result
- [ ] Cron trigger: evaluate cron expression against current time
- [ ] Manual trigger: immediate execution on user request

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

- [ ] On start: load all workflows with `phase === 'active'` from SQLite
- [ ] Maintain a timer map: each workflow's trigger gets its own interval
- [ ] Poll triggers: execute every `interval_seconds`
- [ ] Cron triggers: evaluate every minute, fire when expression matches
- [ ] When a workflow is created/paused/deleted: dynamically add/remove from the loop
- [ ] Error handling: if a trigger check fails, log error, continue to next cycle (don't crash the loop)

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

- [ ] Global concurrency cap: `MAX_CONCURRENT_AGENTS = 5` (configurable)
- [ ] Per-workflow queue: same workflow's multiple trigger fires queue up sequentially (FIFO)
- [ ] Graceful shutdown: don't kill running agents, let them finish naturally

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

- [ ] On daemon restart: query SQLite for workflows with `phase = 'executing'` and runs with `status = 'running'`
- [ ] For interrupted runs: mark as `failed` with error "Daemon restarted during execution"
- [ ] Re-register all active triggers in the TriggerLoop
- [ ] Notify users about interrupted runs via their Channels

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

- [ ] Daemon log: `~/.cueclaw/logs/daemon.log` — main process events, trigger evaluations, errors
- [ ] Execution logs: `~/.cueclaw/logs/executions/{workflow_id}_{date}.log` — per-run detailed logs
- [ ] Log rotation: configurable max file size, keep last N files
- [ ] `cueclaw daemon logs` tails the daemon log with `pino-pretty` formatting
- [ ] Child loggers with context: `logger.child({ workflowId, runId, stepId })`

### 5.8 Workflow State Persistence

- [ ] All state transitions write to SQLite immediately (not batched)
- [ ] Step outputs saved to `step_runs.output_json` after each step completes
- [ ] Workflow phase transitions logged with timestamps
- [ ] Session IDs stored for potential resume after crash (best-effort, not guaranteed)

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

1. Send notification to all connected Channels with the failure details and options (retry / skip / stop)
2. Wait up to `ask_user_timeout` (default: 1 hour, configurable in `config.yaml`)
3. If user responds within timeout → execute their choice
4. If timeout expires → fall back to `stop` behavior (halt execution, mark remaining steps as skipped)
5. Log the timeout event with workflow/run/step context

```typescript
const ASK_USER_TIMEOUT = config.executor?.ask_user_timeout ?? 3_600_000  // 1 hour

async function handleAskUser(step: PlanStep, error: string, router: MessageRouter): Promise<'retry' | 'skip' | 'stop'> {
  // broadcastNotification sends to all Channels; waitForConfirmation is added to
  // MessageRouter as part of Phase 5 to support interactive failure recovery.
  await router.broadcastNotification(
    `Step "${step.id}" failed: ${error}\nOptions: retry / skip / stop`
  )

  const response = await Promise.race([
    router.waitForConfirmation(step.id),
    new Promise<'stop'>(resolve => setTimeout(() => resolve('stop'), ASK_USER_TIMEOUT)),
  ])

  if (response === 'stop') {
    logger.warn({ stepId: step.id }, 'ask_user timed out, falling back to stop')
  }
  return response
}
```

---

## Acceptance Criteria

- [ ] `cueclaw daemon install` creates launchd plist (macOS) or systemd service (Linux)
- [ ] Daemon starts automatically on system boot and restarts after crash
- [ ] `cueclaw daemon status` correctly reports running/stopped state
- [ ] `cueclaw daemon logs` shows formatted log output
- [ ] Poll trigger correctly executes `check_script` and detects new items
- [ ] Cron trigger fires at the configured schedule
- [ ] GroupQueue limits concurrent agent executions to the configured cap
- [ ] Per-workflow queueing prevents concurrent runs of the same workflow
- [ ] Crash recovery marks interrupted runs as failed and notifies users
- [ ] All active triggers re-register after daemon restart
- [ ] Execution logs are written to per-run log files
- [ ] Graceful shutdown waits for running agents to complete

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
