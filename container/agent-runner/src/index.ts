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

// IPC input poller — runs in parallel with query()
const ipcPoller = setInterval(() => {
  const inputDir = '/workspace/ipc/input'
  if (!existsSync(inputDir)) return

  // Check for close sentinel
  if (existsSync('/workspace/ipc/_close')) {
    clearInterval(ipcPoller)
    process.exit(0)
  }

  const files = readdirSync(inputDir).filter(f => f.endsWith('.json')).sort()
  for (const file of files) {
    try {
      const _content = readFileSync(join(inputDir, file), 'utf-8')
      // Handle host messages (context responses, user instructions)
      unlinkSync(join(inputDir, file))
    } catch { /* skip malformed files */ }
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
