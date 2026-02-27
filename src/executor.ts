import type Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import { runAgent, type StepRunResult } from './agent-runner.js'
import { createSession, updateSessionSdkId, deactivateSession } from './session.js'
import {
  insertWorkflowRun,
  updateWorkflowRunStatus,
  insertStepRun,
  updateStepRunStatus,
  updateWorkflowPhase,
} from './db.js'
import { ExecutorError } from './types.js'
import type { Workflow, PlanStep, FailurePolicy, WorkflowRun, StepRun } from './types.js'
import type pino from 'pino'
import { logger, createExecutionLogger } from './logger.js'

// ─── Input Reference Resolution ───

const STEP_REF_PATTERN = /\$steps\.([a-z0-9-]+)\.output/g
const TRIGGER_DATA_PATTERN = /\$trigger_data/g
const MAX_OUTPUT_SIZE = 10240 // 10KB truncation

export function resolveValue(
  value: any,
  completedSteps: Map<string, StepRunResult>,
  triggerData: string | null,
): any {
  if (typeof value === 'string') {
    let shouldSkip = false
    let resolved = value.replace(STEP_REF_PATTERN, (_match, stepId: string) => {
      const result = completedSteps.get(stepId)
      if (!result) return 'null'
      if (result.status === 'failed' || result.status === 'skipped') {
        shouldSkip = true
        return 'null'
      }
      const output = result.output ?? 'null'
      return output.length > MAX_OUTPUT_SIZE
        ? output.slice(0, MAX_OUTPUT_SIZE) + '\n[truncated]'
        : output
    })
    if (shouldSkip) return { __skip: true }
    resolved = resolved.replace(TRIGGER_DATA_PATTERN, triggerData ?? 'null')
    return resolved
  }
  if (Array.isArray(value)) {
    return value.map(item => resolveValue(item, completedSteps, triggerData))
  }
  if (value !== null && typeof value === 'object') {
    return resolveInputs(value, completedSteps, triggerData)
  }
  return value
}

export function resolveInputs(
  inputs: Record<string, any>,
  completedSteps: Map<string, StepRunResult>,
  triggerData: string | null,
): Record<string, any> {
  const resolved: Record<string, any> = {}
  for (const [key, value] of Object.entries(inputs)) {
    resolved[key] = resolveValue(value, completedSteps, triggerData)
  }
  return resolved
}

function hasSkipMarker(inputs: Record<string, any>): boolean {
  for (const value of Object.values(inputs)) {
    if (value && typeof value === 'object' && '__skip' in value) return true
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && hasSkipMarker(value)) return true
  }
  return false
}

// ─── Step Execution ───

export type OnStepFailure = (step: PlanStep, error: string) => Promise<'retry' | 'skip' | 'stop'>

export interface ExecuteOptions {
  workflow: Workflow
  triggerData: string | null
  db: Database.Database
  cwd: string
  onStepFailure?: OnStepFailure
  onProgress?: (stepId: string, msg: any) => void
  signal?: AbortSignal
}

async function executeStepOnce(
  step: PlanStep,
  resolvedInputs: Record<string, any>,
  runId: string,
  db: Database.Database,
  cwd: string,
  onProgress?: (stepId: string, msg: any) => void,
  execLogger?: pino.Logger,
): Promise<StepRunResult> {
  const stepRunId = `sr_${nanoid()}`
  const now = new Date().toISOString()

  const stepRun: StepRun = {
    id: stepRunId,
    run_id: runId,
    step_id: step.id,
    status: 'running',
    started_at: now,
  }
  insertStepRun(db, stepRun)
  execLogger?.info({ stepId: step.id, stepRunId, attempt: 'start' }, `Step started: ${step.id}`)

  // Build prompt from step description + resolved inputs
  const inputContext = Object.keys(resolvedInputs).length > 0
    ? `\n\nInputs:\n${JSON.stringify(resolvedInputs, null, 2)}`
    : ''
  const prompt = `${step.description}${inputContext}`

  const handle = runAgent({
    prompt,
    cwd,
    workflowId: step.id,
    stepId: step.id,
    runId,
    onProgress: onProgress ? (msg) => onProgress(step.id, msg) : undefined,
  })

  const result = await handle.resultPromise

  // Store session if we got one
  if (result.sessionId) {
    const session = createSession(db, stepRunId, result.sessionId)
    updateSessionSdkId(db, session.id, result.sessionId)
    deactivateSession(db, session.id)
    execLogger?.debug({ stepId: step.id, sessionId: session.id }, 'Session stored')
  }

  // Update step run in DB
  updateStepRunStatus(db, stepRunId, result.status, result.output ?? undefined, result.error)

  if (result.status === 'failed') {
    execLogger?.error({ stepId: step.id, stepRunId, error: result.error }, `Step failed: ${step.id}`)
  } else {
    execLogger?.info({ stepId: step.id, stepRunId, status: result.status }, `Step completed: ${step.id}`)
  }

  return result
}

async function executeStepWithRetry(
  step: PlanStep,
  resolvedInputs: Record<string, any>,
  runId: string,
  db: Database.Database,
  cwd: string,
  policy: FailurePolicy,
  onProgress?: (stepId: string, msg: any) => void,
  execLogger?: pino.Logger,
): Promise<StepRunResult> {
  const maxRetries = policy.max_retries ?? 0
  let delay = policy.retry_delay_ms ?? 5000

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await executeStepOnce(step, resolvedInputs, runId, db, cwd, onProgress, execLogger)
    if (result.status !== 'failed' || attempt === maxRetries) return result

    logger.info({ stepId: step.id, attempt, delay }, 'Retrying step')
    await new Promise(r => setTimeout(r, delay))
    delay *= 2
  }

  // Unreachable, but TypeScript needs it
  throw new ExecutorError('Unreachable: step retry loop exited without returning')
}

// ─── Workflow Execution ───

export interface ExecutionResult {
  runId: string
  status: 'completed' | 'failed'
  results: Map<string, StepRunResult>
}

export async function executeWorkflow(opts: ExecuteOptions): Promise<ExecutionResult> {
  const { workflow, triggerData, db, cwd, onStepFailure, onProgress, signal } = opts

  // Create workflow run
  const runId = `run_${nanoid()}`
  const run: WorkflowRun = {
    id: runId,
    workflow_id: workflow.id,
    trigger_data: triggerData,
    status: 'running',
    started_at: new Date().toISOString(),
  }
  insertWorkflowRun(db, run)
  updateWorkflowPhase(db, workflow.id, 'executing')

  const execLogger = createExecutionLogger(workflow.id, runId)
  execLogger.info({ workflowId: workflow.id, runId, steps: workflow.steps.length }, 'Workflow execution started')

  const completed = new Map<string, StepRunResult>()
  const remaining = new Set(workflow.steps.map(s => s.id))
  const stepMap = new Map(workflow.steps.map(s => [s.id, s]))
  let runFailed = false

  try {
    while (remaining.size > 0) {
      if (signal?.aborted) {
        execLogger.warn({ workflowId: workflow.id, runId, remainingSteps: remaining.size }, 'Execution aborted via signal')
        for (const id of remaining) {
          completed.set(id, { status: 'skipped', error: 'Aborted' })
          onProgress?.(id, { status: 'skipped' })
        }
        remaining.clear()
        runFailed = true
        break
      }

      // Find ready steps (all dependencies satisfied)
      const ready = [...remaining].filter(id => {
        const step = stepMap.get(id)!
        return step.depends_on.every(dep => completed.has(dep))
      })

      if (ready.length === 0) {
        execLogger.error({ workflowId: workflow.id, runId, remaining: [...remaining] }, 'Deadlock detected')
        throw new ExecutorError('Deadlock: no ready steps but remaining steps exist')
      }

      // Separate executable from skippable
      const executable: PlanStep[] = []
      for (const id of ready) {
        const step = stepMap.get(id)!

        // Check if any dependency failed
        const depsFailed = step.depends_on.some(
          dep => completed.get(dep)?.status === 'failed' || completed.get(dep)?.status === 'skipped'
        )

        if (depsFailed && workflow.failure_policy.on_step_failure !== 'ask_user') {
          execLogger.debug({ stepId: id, reason: 'dependency_failed' }, 'Step skipped')
          remaining.delete(id)
          completed.set(id, { status: 'skipped' })
          // Record skipped step in DB
          const skipRunId = `sr_${nanoid()}`
          insertStepRun(db, { id: skipRunId, run_id: runId, step_id: id, status: 'skipped' })
          continue
        }

        // Check if resolved inputs have skip markers
        const resolvedInputs = resolveInputs(step.inputs, completed, triggerData)
        if (hasSkipMarker(resolvedInputs)) {
          execLogger.debug({ stepId: id, reason: 'skip_marker' }, 'Step skipped')
          remaining.delete(id)
          completed.set(id, { status: 'skipped' })
          const skipRunId = `sr_${nanoid()}`
          insertStepRun(db, { id: skipRunId, run_id: runId, step_id: id, status: 'skipped' })
          continue
        }

        executable.push(step)
      }

      if (executable.length === 0) continue

      // Execute all ready steps in parallel
      const results = await Promise.all(
        executable.map(async step => {
          remaining.delete(step.id)
          const resolvedInputs = resolveInputs(step.inputs, completed, triggerData)
          const result = await executeStepWithRetry(
            step, resolvedInputs, runId, db, cwd,
            workflow.failure_policy, onProgress, execLogger,
          )
          return { stepId: step.id, result }
        })
      )

      for (const { stepId, result } of results) {
        completed.set(stepId, result)

        if (result.status === 'failed') {
          const policy = workflow.failure_policy.on_step_failure

          if (policy === 'stop') {
            execLogger.warn({ stepId, policy: 'stop' }, 'Stop policy triggered, skipping remaining steps')
            for (const remainingId of remaining) {
              completed.set(remainingId, { status: 'skipped' })
              const skipRunId = `sr_${nanoid()}`
              insertStepRun(db, { id: skipRunId, run_id: runId, step_id: remainingId, status: 'skipped' })
            }
            remaining.clear()
            runFailed = true
            break
          }

          if (policy === 'ask_user' && onStepFailure) {
            const decision = await onStepFailure(stepMap.get(stepId)!, result.error ?? 'Unknown error')
            execLogger.info({ stepId, decision }, 'ask_user decision received')
            if (decision === 'stop') {
              for (const remainingId of remaining) {
                completed.set(remainingId, { status: 'skipped' })
                const skipRunId = `sr_${nanoid()}`
                insertStepRun(db, { id: skipRunId, run_id: runId, step_id: remainingId, status: 'skipped' })
              }
              remaining.clear()
              runFailed = true
              break
            }
            // 'skip' continues naturally via skip_dependents logic
            // 'retry' would need re-adding to remaining, but for now skip_dependents handles it
          }

          // 'skip_dependents': failed deps caught at top of loop
        }
      }
    }
  } catch (err) {
    runFailed = true
    logger.error({ err, runId }, 'Workflow execution error')
  }

  // Finalize workflow run
  const finalStatus = runFailed ? 'failed' : 'completed'
  updateWorkflowRunStatus(db, runId, finalStatus)

  // Update workflow phase
  if (workflow.trigger.type === 'manual') {
    updateWorkflowPhase(db, workflow.id, runFailed ? 'failed' : 'completed')
  } else {
    updateWorkflowPhase(db, workflow.id, 'active')
  }

  execLogger.info({ workflowId: workflow.id, runId, status: finalStatus }, 'Workflow execution finished')

  return { runId, status: finalStatus, results: completed }
}
