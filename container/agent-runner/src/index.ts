import { query } from '@anthropic-ai/claude-agent-sdk'
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

interface ContainerInput {
  prompt: string
  workflowId: string
  stepId: string
  runId: string
  apiKey: string
  allowedTools?: string[]
}

// Read input from stdin
const chunks: Buffer[] = []
for await (const chunk of process.stdin) {
  chunks.push(chunk)
}
const input: ContainerInput = JSON.parse(Buffer.concat(chunks).toString())

// Set environment for MCP server
process.env.CUECLAW_WORKFLOW_ID = input.workflowId
process.env.CUECLAW_STEP_ID = input.stepId
process.env.CUECLAW_RUN_ID = input.runId

// Set API key from stdin input
process.env.ANTHROPIC_API_KEY = input.apiKey

let sessionId: string | undefined
let result: string | null = null
const abortController = new AbortController()

// IPC input poller — runs in parallel with query()
const ipcPoller = setInterval(() => {
  const inputDir = '/workspace/ipc/input'
  if (!existsSync(inputDir)) return

  // Check for close sentinel
  if (existsSync('/workspace/ipc/_close')) {
    clearInterval(ipcPoller)
    abortController.abort()
    return
  }

  const files = readdirSync(inputDir).filter(f => f.endsWith('.json')).sort()
  for (const file of files) {
    const filePath = join(inputDir, file)
    try {
      const content = readFileSync(filePath, 'utf-8')
      const msg = JSON.parse(content)
      if (msg.type === 'close') {
        clearInterval(ipcPoller)
        abortController.abort()
        return
      }
      // Log host messages for debugging; full injection into agent session
      // requires SDK streaming support (not yet available)
      process.stderr.write(`[ipc] received: ${msg.type ?? 'unknown'}\n`)
      unlinkSync(filePath)
    } catch {
      // Drop malformed files to avoid retry loops.
      try { unlinkSync(filePath) } catch { /* ignore cleanup errors */ }
      process.stderr.write(`[ipc] dropped malformed message: ${file}\n`)
    }
  }
}, 500)

try {
  for await (const message of query({
    prompt: input.prompt,
    options: {
      cwd: '/workspace/work',
      allowedTools: input.allowedTools ?? [
        'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
        'WebSearch', 'WebFetch', 'Task', 'TaskOutput',
      ],
      settingSources: ['project'],
      permissionMode: 'default',
      abortController,
    },
  })) {
    if (message.type === 'system' && message.subtype === 'init') {
      sessionId = message.session_id
    }
    if ('result' in message) {
      result = message.result ?? null
    }
  }
} finally {
  clearInterval(ipcPoller)
}

// Output result using marker protocol
const output = JSON.stringify({ result, sessionId })
process.stdout.write('---CUECLAW_OUTPUT_START---\n')
process.stdout.write(output)
process.stdout.write('\n---CUECLAW_OUTPUT_END---\n')
