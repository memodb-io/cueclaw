import type Database from 'better-sqlite3'
import type { IpcMessage, IpcWatcher } from './ipc.js'
import { logger as rootLogger } from './logger.js'

/** Minimal router interface for Phase 2. Full implementation in Phase 4/5. */
export interface MessageRouter {
  broadcastNotification(message: string): void
}

export class McpMessageHandler {
  private log = rootLogger.child({ module: 'mcp-handler' })

  constructor(
    private db: Database.Database,
    private router: MessageRouter,
    private ipcWatcher: IpcWatcher,
  ) {}

  handle(msg: IpcMessage): void {
    switch (msg.type) {
      case 'progress':
        this.handleProgress(msg)
        break
      case 'notification':
        this.handleNotification(msg)
        break
      case 'context_request':
        this.handleContextRequest(msg)
        break
      default:
        this.log.warn({ type: msg.type }, 'Unknown IPC message type')
    }
  }

  private handleProgress(msg: IpcMessage): void {
    this.db.prepare(
      'UPDATE step_runs SET status = ?, output_json = ? WHERE step_id = ? AND run_id = ?'
    ).run(msg.data.status, msg.data.output ?? null, msg.stepId, msg.data.runId)

    this.log.info({ stepId: msg.stepId, status: msg.data.status }, 'Step progress update')
  }

  private handleNotification(msg: IpcMessage): void {
    this.router.broadcastNotification(msg.data.message)
  }

  private handleContextRequest(msg: IpcMessage): void {
    const stepRun = this.db.prepare(
      'SELECT output_json FROM step_runs WHERE step_id = ? AND run_id = ?'
    ).get(msg.data.requestedStepId, msg.data.runId) as { output_json: string | null } | undefined

    this.ipcWatcher.sendToContainer({
      workflowId: msg.workflowId,
      stepId: msg.stepId,
      type: 'user_message',
      correlationId: msg.correlationId,
      data: { context: stepRun?.output_json ?? null },
      timestamp: new Date().toISOString(),
    })
  }
}
