import { logger } from './logger.js'

/**
 * Concurrency control for workflow execution.
 * - Global cap on concurrent agents
 * - Per-workflow serialization (same workflow runs sequentially)
 */
export class GroupQueue {
  private running = 0
  private runningByWorkflow = new Set<string>()
  private queue: Array<{
    workflowId: string
    task: () => Promise<void>
  }> = []

  constructor(private maxConcurrent = 5) {}

  async enqueue(workflowId: string, task: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const wrappedTask = async () => {
        try {
          await task()
          resolve()
        } catch (e) {
          reject(e)
        }
      }

      if (this.running >= this.maxConcurrent || this.runningByWorkflow.has(workflowId)) {
        this.queue.push({ workflowId, task: wrappedTask })
        logger.debug({ workflowId, queueLength: this.queue.length }, 'Task queued')
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
    const idx = this.queue.findIndex(item => !this.runningByWorkflow.has(item.workflowId))
    if (idx === -1 || this.running >= this.maxConcurrent) return

    const next = this.queue.splice(idx, 1)[0]!
    this.running++
    this.runningByWorkflow.add(next.workflowId)
    next.task().finally(() => {
      this.running--
      this.runningByWorkflow.delete(next.workflowId)
      this.processNext()
    })
  }

  get pendingCount(): number {
    return this.queue.length
  }

  get activeCount(): number {
    return this.running
  }
}
