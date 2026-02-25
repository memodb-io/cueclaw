import { writeFileSync, renameSync, existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const WORKFLOW_ID = process.env.CUECLAW_WORKFLOW_ID!
const STEP_ID = process.env.CUECLAW_STEP_ID!
const RUN_ID = process.env.CUECLAW_RUN_ID!
const IPC_OUTPUT_DIR = '/workspace/ipc/output'

interface IpcMessage {
  workflowId: string
  stepId: string
  type: 'progress' | 'notification' | 'context_request' | 'user_message'
  correlationId?: string
  data: Record<string, unknown>
  timestamp: string
}

function randomId(length = 6): string {
  return Math.random().toString(36).slice(2, 2 + length)
}

async function writeIpcMessage(msg: IpcMessage): Promise<void> {
  const filename = `${Date.now()}-${randomId()}.json`
  const tempPath = join(IPC_OUTPUT_DIR, `.${filename}.tmp`)
  const finalPath = join(IPC_OUTPUT_DIR, filename)
  writeFileSync(tempPath, JSON.stringify(msg))
  renameSync(tempPath, finalPath)
}

async function pollForResponse(inputDir: string, correlationId: string, timeoutMs: number, pollIntervalMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(inputDir)) {
      const files = readdirSync(inputDir).filter(f => f.endsWith('.json')).sort()
      for (const file of files) {
        try {
          const content = readFileSync(join(inputDir, file), 'utf-8')
          const msg = JSON.parse(content) as IpcMessage
          if (msg.correlationId === correlationId) {
            unlinkSync(join(inputDir, file))
            return JSON.stringify(msg.data)
          }
        } catch { /* skip malformed */ }
      }
    }
    await new Promise(r => setTimeout(r, pollIntervalMs))
  }
  return null
}

// Export tool handlers for use by the MCP server
export async function reportProgress(status: string, message: string, output?: string): Promise<string> {
  await writeIpcMessage({
    workflowId: WORKFLOW_ID, stepId: STEP_ID, type: 'progress',
    data: { status, message, output, runId: RUN_ID },
    timestamp: new Date().toISOString(),
  })
  return `Progress reported: ${status}`
}

export async function notify(message: string): Promise<string> {
  await writeIpcMessage({
    workflowId: WORKFLOW_ID, stepId: STEP_ID, type: 'notification',
    data: { message },
    timestamp: new Date().toISOString(),
  })
  return 'Notification sent'
}

export async function getContext(stepId: string): Promise<string> {
  const correlationId = randomId(12)
  await writeIpcMessage({
    workflowId: WORKFLOW_ID, stepId: STEP_ID, type: 'context_request',
    correlationId,
    data: { requestedStepId: stepId, runId: RUN_ID },
    timestamp: new Date().toISOString(),
  })
  const response = await pollForResponse('/workspace/ipc/input/', correlationId, 30_000, 500)
  return response ?? 'No context available'
}
