import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type Database from 'better-sqlite3'
import type { Workflow, TriggerConfig } from './types.js'
import { logger } from './logger.js'

const execFileAsync = promisify(execFile)

export interface TriggerResult {
  workflowId: string
  data: string
}

const CHECK_SCRIPT_TIMEOUT = 30_000

/**
 * Evaluate a workflow's poll trigger.
 * Executes check_script, compares output to last result, returns trigger data if changed.
 */
export async function evaluatePollTrigger(
  workflow: Workflow,
  trigger: Extract<TriggerConfig, { type: 'poll' }>,
  db: Database.Database,
): Promise<TriggerResult | null> {
  let stdout: string
  try {
    const result = await execFileAsync('sh', ['-c', trigger.check_script], {
      timeout: CHECK_SCRIPT_TIMEOUT,
      encoding: 'utf-8',
    })
    stdout = result.stdout.trim()
  } catch (err) {
    logger.error({ workflowId: workflow.id, err }, 'Poll check_script failed')
    db.prepare(
      'INSERT OR REPLACE INTO trigger_state (workflow_id, last_error, last_check_at) VALUES (?, ?, ?)'
    ).run(workflow.id, err instanceof Error ? err.message : String(err), new Date().toISOString())
    return null
  }

  // Load last result
  const state = db.prepare(
    'SELECT last_result FROM trigger_state WHERE workflow_id = ?'
  ).get(workflow.id) as { last_result: string | null } | undefined

  let triggerData: string | null = null

  if (trigger.diff_mode === 'new_items') {
    const newItems = diffNewItems(state?.last_result ?? null, stdout)
    if (newItems.length > 0) triggerData = newItems.join('\n')
  } else {
    if (state?.last_result !== stdout) triggerData = stdout
  }

  // Save current result
  db.prepare(
    'INSERT OR REPLACE INTO trigger_state (workflow_id, last_result, last_check_at) VALUES (?, ?, ?)'
  ).run(workflow.id, stdout, new Date().toISOString())

  if (!triggerData) return null

  logger.info({ workflowId: workflow.id }, 'Poll trigger fired')
  return { workflowId: workflow.id, data: triggerData }
}

/**
 * Diff new items between old and new output (line-based).
 */
export function diffNewItems(oldOutput: string | null, newOutput: string): string[] {
  if (!oldOutput) return newOutput ? newOutput.split('\n').filter(Boolean) : []
  const oldLines = new Set(oldOutput.split('\n').filter(Boolean))
  return newOutput.split('\n').filter(line => line && !oldLines.has(line))
}
