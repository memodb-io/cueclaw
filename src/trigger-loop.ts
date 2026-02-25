import type Database from 'better-sqlite3'
import { CronExpressionParser } from 'cron-parser'
import type { Workflow } from './types.js'
import { evaluatePollTrigger } from './trigger.js'
import { executeWorkflow } from './executor.js'
import { GroupQueue } from './group-queue.js'
import { logger } from './logger.js'
import type { MessageRouter } from './router.js'

interface WorkflowRow {
  id: string
  name: string
  description: string
  steps_json: string
  trigger_json: string
  failure_policy_json: string
  phase: string
  schema_version: number
  metadata_json: string | null
  created_at: string
  updated_at: string
}

export class TriggerLoop {
  private intervals = new Map<string, NodeJS.Timeout>()
  private queue: GroupQueue
  private log = logger.child({ module: 'trigger-loop' })

  constructor(
    private db: Database.Database,
    private router: MessageRouter,
    private cwd: string,
    maxConcurrent = 5,
  ) {
    this.queue = new GroupQueue(maxConcurrent)
  }

  start(): void {
    const rows = this.db.prepare(
      "SELECT * FROM workflows WHERE phase = 'active'"
    ).all() as WorkflowRow[]

    for (const row of rows) {
      const workflow = this.rowToWorkflow(row)
      this.registerTrigger(workflow)
    }

    this.log.info({ count: rows.length }, 'Trigger loop started')
  }

  registerTrigger(workflow: Workflow): void {
    // Remove existing if re-registering
    this.unregisterTrigger(workflow.id)

    const trigger = workflow.trigger

    if (trigger.type === 'poll') {
      const interval = setInterval(() => {
        try {
          const result = evaluatePollTrigger(workflow, trigger, this.db)
          if (result) {
            this.executeTrigger(workflow, result.data)
          }
        } catch (err) {
          this.log.error({ workflowId: workflow.id, err }, 'Poll trigger error')
        }
      }, trigger.interval_seconds * 1000)
      this.intervals.set(workflow.id, interval)
      this.log.info({ workflowId: workflow.id, intervalSeconds: trigger.interval_seconds }, 'Registered poll trigger')
    }

    if (trigger.type === 'cron') {
      const interval = setInterval(() => {
        try {
          const expr = CronExpressionParser.parse(trigger.expression, {
            tz: trigger.timezone ?? 'UTC',
          })
          const prev = expr.prev().toDate()
          const now = new Date()

          if (now.getTime() - prev.getTime() < 60_000) {
            // Dedup check
            const state = this.db.prepare(
              'SELECT last_fire_at FROM trigger_state WHERE workflow_id = ?'
            ).get(workflow.id) as { last_fire_at: string | null } | undefined
            const lastFire = state?.last_fire_at ? new Date(state.last_fire_at).getTime() : 0
            if (prev.getTime() <= lastFire) return

            this.db.prepare(
              'INSERT OR REPLACE INTO trigger_state (workflow_id, last_fire_at) VALUES (?, ?)'
            ).run(workflow.id, prev.toISOString())

            this.executeTrigger(workflow, new Date().toISOString())
          }
        } catch (err) {
          this.log.error({ workflowId: workflow.id, err }, 'Cron evaluation failed')
        }
      }, 60_000)
      this.intervals.set(workflow.id, interval)
      this.log.info({ workflowId: workflow.id, expression: trigger.expression }, 'Registered cron trigger')
    }
  }

  unregisterTrigger(workflowId: string): void {
    const interval = this.intervals.get(workflowId)
    if (interval) {
      clearInterval(interval)
      this.intervals.delete(workflowId)
    }
  }

  private executeTrigger(workflow: Workflow, triggerData: string): void {
    this.queue.enqueue(workflow.id, async () => {
      this.log.info({ workflowId: workflow.id }, 'Executing triggered workflow')
      try {
        await executeWorkflow({
          workflow,
          triggerData,
          db: this.db,
          cwd: this.cwd,
          onProgress: (_stepId, msg) => {
            if (typeof msg === 'object' && msg?.type === 'step_complete') {
              this.router.broadcastNotification(`Step completed: ${_stepId} (${workflow.name})`)
            }
          },
        })
        this.router.broadcastNotification(`Workflow complete: ${workflow.name}`)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        this.log.error({ workflowId: workflow.id, err }, 'Triggered execution failed')
        this.router.broadcastNotification(`Workflow failed: ${workflow.name} — ${errMsg}`)
      }
    }).catch(err => {
      this.log.error({ workflowId: workflow.id, err }, 'Queue execution error')
    })
  }

  stop(): void {
    for (const interval of this.intervals.values()) {
      clearInterval(interval)
    }
    this.intervals.clear()
    this.log.info('Trigger loop stopped')
  }

  get registeredCount(): number {
    return this.intervals.size
  }

  private rowToWorkflow(row: WorkflowRow): Workflow {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      steps: JSON.parse(row.steps_json),
      trigger: JSON.parse(row.trigger_json),
      failure_policy: JSON.parse(row.failure_policy_json),
      phase: row.phase as Workflow['phase'],
      schema_version: '1.0',
      created_at: row.created_at,
      updated_at: row.updated_at,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
    }
  }
}
