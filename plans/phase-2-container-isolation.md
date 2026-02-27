# Phase 2: Container Isolation

> **Goal:** Run workflow steps inside Docker containers with OS-level isolation, host ↔ container IPC, and MCP tool injection — completing the security model's Level 2.
>
> **Prerequisites:** Phase 0 (scaffolding) + Phase 1 (Executor, Agent Runner)
>
> **Reference:** Based on NanoClaw's production implementation ([docs/references.md](../docs/references.md))

---

## What Gets Built

By the end of Phase 2:
1. Workflow steps run inside Docker containers with isolated filesystems
2. Host and container communicate via file-polling IPC
3. Container agents have MCP tools for progress reporting, notifications, and context access
4. Mount allowlist controls which host directories are accessible to containers
5. `cueclaw setup` validates Docker, builds the container image, and runs a smoke test
6. `agent-runner.ts` transparently switches between local and container execution based on config

---

## What Already Exists (from Phase 0–1)

- Agent Runner wraps Claude Agent SDK `query()` (Phase 1)
- Executor runs workflow steps via Agent Runner (Phase 1)
- PreToolUse hooks for local safety (Phase 1)
- SQLite persistence for workflows, runs, steps, sessions (Phase 0)
- Config system with Zod validation (Phase 0)

Phase 2 wraps the Agent Runner in a container, adding OS-level isolation on top of app-level hooks.

---

## Tasks

### 2.1 Mount Security (`src/mount-security.ts`)

Controls which host directories can be mounted into containers.

- [x] Load mount allowlist from `~/.cueclaw/mount-allowlist.json`
- [x] Default blocked patterns: `.ssh`, `.gnupg`, `.aws`, `.env`, `credentials`, `private_key`, `.docker`
- [x] `validateAdditionalMounts(mounts, allowlist)` — check each mount against allowed roots and blocked patterns
- [x] `generateDefaultAllowlist()` — create sensible defaults on first run
- [x] Path expansion: `~` → home directory
- [x] Blocked mounts throw `ConfigError` with clear message

```typescript
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { ConfigError } from './types.js'

interface AllowedRoot {
  path: string
  allowReadWrite: boolean
  description?: string
}

interface MountAllowlist {
  allowedRoots: AllowedRoot[]
  blockedPatterns: string[]
  nonMainReadOnly: boolean
}

export function loadMountAllowlist(): MountAllowlist {
  const path = join(cueclawHome(), 'mount-allowlist.json')
  if (!existsSync(path)) {
    const defaults = generateDefaultAllowlist()
    writeFileSync(path, JSON.stringify(defaults, null, 2))
    return defaults
  }
  return JSON.parse(readFileSync(path, 'utf-8'))
}

export function validateAdditionalMounts(
  mounts: AdditionalMount[],
  allowlist: MountAllowlist
): void {
  for (const mount of mounts) {
    const expanded = expandHome(mount.hostPath)

    // Check blocked patterns
    for (const pattern of allowlist.blockedPatterns) {
      if (expanded.includes(pattern)) {
        throw new ConfigError(`Mount blocked: "${mount.hostPath}" matches blocked pattern "${pattern}"`)
      }
    }

    // Check against allowed roots
    const allowed = allowlist.allowedRoots.find(root =>
      expanded.startsWith(expandHome(root.path))
    )
    if (!allowed) {
      throw new ConfigError(`Mount not in allowlist: "${mount.hostPath}". Add it to ~/.cueclaw/mount-allowlist.json`)
    }

    // Check read-write permission
    if (!mount.readonly && !allowed.allowReadWrite) {
      throw new ConfigError(`Mount "${mount.hostPath}" is read-only in allowlist but requested read-write`)
    }
  }
}

function generateDefaultAllowlist(): MountAllowlist {
  return {
    allowedRoots: [
      { path: '~/projects', allowReadWrite: true, description: 'User project directories' },
      { path: '/tmp', allowReadWrite: true, description: 'Temporary files' },
    ],
    blockedPatterns: ['.ssh', '.gnupg', '.aws', '.env', 'credentials', 'private_key', '.docker'],
    nonMainReadOnly: true,
  }
}
```

**Test strategy:** Unit tests with various mount/allowlist combinations. No Docker needed.

### 2.2 Container Runner (`src/container-runner.ts`)

Spawns Docker containers for step execution with layered mount strategy.

- [x] `runContainerAgent(opts)` — spawn container, pipe input via stdin, capture output
- [x] Mount strategy (layered):
  1. Project root → `/workspace/project` (read-only)
  2. Working directory → `/workspace/work` (writable, per-workflow isolation)
  3. IPC directory → `/workspace/ipc` (host ↔ container communication)
  4. Validated additional mounts from config
- [x] Stdin/stdout JSON protocol — step input sent via stdin (never written to disk)
- [x] Output streaming via markers: `---CUECLAW_OUTPUT_START---` / `---CUECLAW_OUTPUT_END---`
- [x] Output size cap: `max_output_size` (default 10MB) with truncation flags
- [x] Timeout management: hard timeout + idle timeout, graceful `docker stop` (15s) before SIGKILL
- [x] Container naming: `cueclaw-{workflowId}-{stepId}-{timestamp}`
- [x] Secrets passed via stdin JSON, NOT environment variables
- [x] Container logs written to `~/.cueclaw/logs/container-{timestamp}.log`

```typescript
import { spawn, ChildProcess } from 'child_process'

interface ContainerRunnerOpts {
  workflowId: string
  stepId: string
  runId: string
  prompt: string
  cwd: string                            // Project root to mount read-only
  workDir: string                        // Writable working directory
  ipcDir: string                         // IPC directory for this workflow
  allowedTools?: string[]
  additionalMounts?: AdditionalMount[]
  signal?: AbortSignal
  onProgress?: (output: ContainerOutput) => void
}

interface ContainerOutput {
  type: 'progress' | 'result'
  data: string
  truncated?: boolean
}

export async function runContainerAgent(opts: ContainerRunnerOpts): Promise<{
  result: string | null
  sessionId: string | undefined
}> {
  const allowlist = loadMountAllowlist()
  if (opts.additionalMounts) {
    validateAdditionalMounts(opts.additionalMounts, allowlist)
  }

  const config = loadConfig()
  const containerName = `cueclaw-${opts.workflowId}-${opts.stepId}-${Date.now()}`
  const mounts = buildVolumeMounts(opts, allowlist)
  const containerArgs = buildContainerArgs(mounts, config)

  const proc = spawn('docker', ['run', '--rm', '-i', '--name', containerName, ...containerArgs], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  // Send step input via stdin — secrets delivered via stdin, never exposed as env var
  const input: ContainerInput = {
    prompt: opts.prompt,
    workflowId: opts.workflowId,
    stepId: opts.stepId,
    runId: opts.runId,
    apiKey: config.claude.api_key,     // Delivered via stdin, never exposed as env var
    allowedTools: opts.allowedTools,
  }
  proc.stdin.write(JSON.stringify(input))
  proc.stdin.end()

  // Stream output, detect markers, enforce size cap
  return captureOutput(proc, opts, containerName)
}

function buildVolumeMounts(opts: ContainerRunnerOpts, allowlist: MountAllowlist): string[] {
  const mounts = [
    `-v`, `${opts.cwd}:/workspace/project:ro`,
    `-v`, `${opts.workDir}:/workspace/work`,
    `-v`, `${opts.ipcDir}:/workspace/ipc`,
  ]

  for (const mount of opts.additionalMounts ?? []) {
    const expanded = expandHome(mount.hostPath)
    const containerPath = mount.containerPath ?? `/workspace/mounts${expanded}`
    const mode = mount.readonly !== false ? 'ro' : 'rw'
    mounts.push('-v', `${expanded}:${containerPath}:${mode}`)
  }

  return mounts
}

function buildContainerArgs(mounts: string[], config: CueclawConfig): string[] {
  const network = config.container?.network ?? 'none'
  return [
    '--network', network,                 // Default 'none'; set to 'bridge' for external API access
    '--user', '1000:1000',                // Non-root execution
    '--memory', '4g',                     // Memory limit
    '--cpus', '2',                        // CPU limit
    ...mounts,
    CONTAINER_IMAGE,
  ]
  // Note: --name is passed only in the spawn() call to avoid duplication
}
```

**Timeout management:**

```typescript
async function captureOutput(
  proc: ChildProcess,
  opts: ContainerRunnerOpts,
  containerName: string
): Promise<{ result: string | null; sessionId: string | undefined }> {
  const config = loadConfig()
  const hardTimeout = config.container?.timeout ?? 1_800_000
  const idleTimeout = config.container?.idle_timeout ?? 1_800_000
  const maxOutputSize = config.container?.max_output_size ?? 10_485_760

  let lastActivity = Date.now()
  let totalOutput = 0
  let result: string | null = null
  let sessionId: string | undefined

  // Hard timeout
  const hardTimer = setTimeout(async () => {
    await gracefulStop(containerName)
  }, hardTimeout)

  // Idle timeout — resets on output
  const idleCheck = setInterval(async () => {
    if (Date.now() - lastActivity > idleTimeout) {
      await gracefulStop(containerName)
    }
  }, 10_000)

  // Abort signal support
  opts.signal?.addEventListener('abort', () => gracefulStop(containerName))

  // ... stdout parsing with marker detection ...

  clearTimeout(hardTimer)
  clearInterval(idleCheck)
  return { result, sessionId }
}

async function gracefulStop(containerName: string): Promise<void> {
  // docker stop gives 15s grace period by default
  spawn('docker', ['stop', containerName])
}
```

**Test strategy:** Integration tests requiring Docker. Mock `spawn` for unit tests.

### 2.3 IPC Watcher (`src/ipc.ts`)

Host-side file-polling watcher for container → host communication.

- [x] Poll `~/.cueclaw/ipc/{workflowId}/{stepId}/output/` directory for new JSON files
- [x] File naming: `{timestamp}-{nanoid}.json` — atomic writes (temp file → rename)
- [x] Message types: `progress`, `notification`, `context_request`
- [x] Authorization: verify `workflowId` in message matches the IPC directory
- [x] Error handling: malformed JSON files moved to `errors/` subdirectory
- [x] `_close` sentinel file signals container has finished
- [x] Configurable poll interval (default: 500ms)
- [x] Write host → container messages to `input/` directory

```typescript
export class IpcWatcher {
  private timeout: NodeJS.Timeout | null = null

  constructor(
    private workflowId: string,
    private stepId: string,
    private ipcDir: string,          // ~/.cueclaw/ipc/{workflowId}/{stepId}/
    private onMessage: (msg: IpcMessage) => void,
    private pollInterval = 500
  ) {}

  start(): void {
    this.scheduleNext()
  }

  /** Recursive setTimeout prevents overlapping polls when poll() takes longer than the interval */
  private scheduleNext(): void {
    this.timeout = setTimeout(async () => {
      await this.poll()
      this.scheduleNext()
    }, this.pollInterval)
  }

  stop(): void {
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }
  }

  private async poll(): Promise<void> {
    const outputDir = join(this.ipcDir, 'output')
    if (!existsSync(outputDir)) return

    const files = readdirSync(outputDir)
      .filter(f => f.endsWith('.json'))
      .sort()  // Chronological order by timestamp prefix

    for (const file of files) {
      const filePath = join(outputDir, file)
      try {
        const content = readFileSync(filePath, 'utf-8')
        const msg = JSON.parse(content) as IpcMessage
        if (msg.workflowId !== this.workflowId) {
          logger.warn({ file, expected: this.workflowId, got: msg.workflowId }, 'IPC message workflow mismatch')
          moveToErrors(filePath, outputDir)
          continue
        }
        this.onMessage(msg)
        unlinkSync(filePath)  // Processed successfully
      } catch (err) {
        logger.error({ file, err }, 'Failed to process IPC message')
        moveToErrors(filePath, outputDir)
      }
    }
  }

  /** Send a message from host to container */
  sendToContainer(msg: IpcMessage): void {
    const inputDir = join(this.ipcDir, 'input')
    mkdirSync(inputDir, { recursive: true })
    const filename = `${Date.now()}-${nanoid(6)}.json`
    const tempPath = join(inputDir, `.${filename}.tmp`)
    const finalPath = join(inputDir, filename)
    writeFileSync(tempPath, JSON.stringify(msg))
    renameSync(tempPath, finalPath)  // Atomic write
  }

  /** Signal container to shut down */
  signalClose(): void {
    writeFileSync(join(this.ipcDir, '_close'), '')
  }
}

interface IpcMessage {
  workflowId: string
  stepId: string
  type: 'progress' | 'notification' | 'context_request' | 'user_message'
  correlationId?: string            // nanoid — used to match context_request with response
  data: any
  timestamp: string
}
```

**Test strategy:** Unit tests with temp directories. No Docker needed.

### 2.4 CueClaw MCP Server — Host Side (`src/mcp-server.ts`)

Processes IPC output from containers and dispatches to the appropriate handlers.

- [x] Handle `progress` messages: update step status in DB, forward to onProgress callback
- [x] Handle `notification` messages: route through MessageRouter to all connected Channels
- [x] Handle `context_request` messages: load requested step outputs from DB, write to IPC input
- [x] Integrate with IpcWatcher — receives parsed IpcMessages

```typescript
export class McpMessageHandler {
  constructor(
    private db: Database,
    private router: MessageRouter,
    private ipcWatcher: IpcWatcher,
    private logger: Logger
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
    }
  }

  private handleProgress(msg: IpcMessage): void {
    // Update step_runs in DB
    this.db.prepare(
      'UPDATE step_runs SET status = ?, output_json = ? WHERE step_id = ? AND run_id = ?'
    ).run(msg.data.status, msg.data.output, msg.stepId, msg.data.runId)

    this.logger.info({ stepId: msg.stepId, status: msg.data.status }, 'Step progress update')
  }

  private handleNotification(msg: IpcMessage): void {
    // Route notification to all connected Channels
    this.router.broadcastNotification(msg.data.message)
  }

  private handleContextRequest(msg: IpcMessage): void {
    // Load requested step output from DB and send to container
    const stepRun = this.db.prepare(
      'SELECT output_json FROM step_runs WHERE step_id = ? AND run_id = ?'
    ).get(msg.data.requestedStepId, msg.data.runId)

    // Include correlationId so the container can match this response to the original request
    this.ipcWatcher.sendToContainer({
      workflowId: msg.workflowId,
      stepId: msg.stepId,
      type: 'user_message',
      correlationId: msg.correlationId,       // Round-trip the correlationId for response matching
      data: { context: stepRun?.output_json ?? null },
      timestamp: new Date().toISOString(),
    })
  }
}
```

### 2.5 Container IPC Helpers (`container/agent-runner/src/ipc-mcp-stdio.ts`)

> **Implementation note:** The actual implementation uses plain exported async functions (not a real MCP server). The `@modelcontextprotocol/sdk` is not used. Functions are called directly by the container agent runner, not via MCP protocol.

- [x] Plain exported functions (not MCP server): `reportProgress()`, `notify()`, `getContext()`
- [x] Reads context from environment: `CUECLAW_WORKFLOW_ID`, `CUECLAW_STEP_ID`, `CUECLAW_RUN_ID`
- [x] Atomic file writes to IPC output directory (temp file → rename)
- [ ] Tools:
  - `cueclaw_report_progress` — write progress update to IPC
  - `cueclaw_notify` — send notification to user via IPC → host → Channels
  - `cueclaw_get_context` — request preceding step results from host
  - `cueclaw_create_subtask` — request host to create a dynamic sub-step (future use, stub for now)

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const WORKFLOW_ID = process.env.CUECLAW_WORKFLOW_ID!
const STEP_ID = process.env.CUECLAW_STEP_ID!
const RUN_ID = process.env.CUECLAW_RUN_ID!
const IPC_OUTPUT_DIR = '/workspace/ipc/output'  // Mapped from ~/.cueclaw/ipc/{workflowId}/{stepId}/output

const server = new McpServer({ name: 'cueclaw', version: '1.0.0' })

server.registerTool('cueclaw_report_progress', {
  description: 'Report step execution progress to the host',
  inputSchema: z.object({
    status: z.enum(['running', 'succeeded', 'failed']),
    message: z.string(),
    output: z.string().optional(),
  }),
}, async ({ input: { status, message, output } }) => {
  await writeIpcMessage({
    workflowId: WORKFLOW_ID,
    stepId: STEP_ID,
    type: 'progress',
    data: { status, message, output, runId: RUN_ID },
    timestamp: new Date().toISOString(),
  })
  return { content: [{ type: 'text', text: `Progress reported: ${status}` }] }
})

server.registerTool('cueclaw_notify', {
  description: 'Send a notification to the user via all connected channels',
  inputSchema: z.object({
    message: z.string().describe('Notification message to send'),
  }),
}, async ({ input: { message } }) => {
  await writeIpcMessage({
    workflowId: WORKFLOW_ID,
    stepId: STEP_ID,
    type: 'notification',
    data: { message },
    timestamp: new Date().toISOString(),
  })
  return { content: [{ type: 'text', text: 'Notification sent' }] }
})

server.registerTool('cueclaw_get_context', {
  description: 'Get output from a preceding step',
  inputSchema: z.object({
    step_id: z.string().describe('ID of the step whose output to retrieve'),
  }),
}, async ({ input: { step_id } }) => {
  const correlationId = nanoid()
  await writeIpcMessage({
    workflowId: WORKFLOW_ID,
    stepId: STEP_ID,
    type: 'context_request',
    correlationId,
    data: { requestedStepId: step_id, runId: RUN_ID },
    timestamp: new Date().toISOString(),
  })
  // Wait for host to write response to input directory, matched by correlationId
  // Timeout: 30s, poll interval: 500ms, returns null on timeout
  const response = await pollForResponse(`/workspace/ipc/input/`, correlationId, 30_000, 500)
  return { content: [{ type: 'text', text: response ?? 'No context available' }] }
})

server.registerTool('cueclaw_create_subtask', {
  description: 'Create a dynamic sub-step within the current workflow (future use)',
  inputSchema: z.object({
    description: z.string(),
    depends_on: z.array(z.string()).optional(),
  }),
}, async () => {
  return { content: [{ type: 'text', text: 'Subtask creation not yet implemented' }] }
})

// Atomic file write helper
async function writeIpcMessage(msg: IpcMessage): Promise<void> {
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
  const tempPath = join(IPC_OUTPUT_DIR, `.${filename}.tmp`)
  const finalPath = join(IPC_OUTPUT_DIR, filename)
  writeFileSync(tempPath, JSON.stringify(msg))
  renameSync(tempPath, finalPath)
}

// Start server
const transport = new StdioServerTransport()
await server.connect(transport)
```

### 2.6 Container Agent Runner (`container/agent-runner/src/index.ts`)

Entry point for the agent running inside the Docker container.

- [x] Read step input from stdin (JSON)
- [x] Call Claude Agent SDK `query()` with:
  - Working directory: `/workspace/work`
  - Allowed tools from input
  - MCP server as tool provider
  - `settingSources: ['project']` for skills from `/workspace/project/.claude/skills/`
- [x] Stream output using marker protocol for host capture
- [x] Poll IPC input directory for mid-execution messages from host (every 500ms)
- [x] Detect `_close` sentinel for graceful shutdown
- [x] Extract and return session_id and result

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'

interface ContainerInput {
  prompt: string
  workflowId: string
  stepId: string
  runId: string
  apiKey: string                     // Delivered via stdin, never exposed as env var
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

// Set API key from stdin input — delivered via stdin, never exposed as env var
process.env.ANTHROPIC_API_KEY = input.apiKey

let sessionId: string | undefined
let result: string | null = null

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

// Output result using marker protocol
const output = JSON.stringify({ result, sessionId })
process.stdout.write('---CUECLAW_OUTPUT_START---\n')
process.stdout.write(output)
process.stdout.write('\n---CUECLAW_OUTPUT_END---\n')
```

**IPC input polling (parallel to query execution):**

```typescript
// Run in parallel with query() — poll for host messages
const ipcPoller = setInterval(() => {
  const inputDir = '/workspace/ipc/input'
  if (!existsSync(inputDir)) return

  // Check for close sentinel (per-step)
  if (existsSync('/workspace/ipc/_close')) {
    clearInterval(ipcPoller)
    process.exit(0)
  }

  const files = readdirSync(inputDir).filter(f => f.endsWith('.json')).sort()
  for (const file of files) {
    try {
      const content = readFileSync(join(inputDir, file), 'utf-8')
      const msg = JSON.parse(content)
      // Handle host messages (e.g., context responses, user instructions)
      unlinkSync(join(inputDir, file))
    } catch { /* skip malformed files */ }
  }
}, 500)
```

### 2.7 Container Image (`container/Dockerfile` + `container/build.sh`)

- [x] Dockerfile: `node:22-slim` base, install agent-runner, non-root user
- [x] `build.sh`: build agent-runner TypeScript, then `docker build`
- [x] `.dockerignore` to exclude unnecessary files

```dockerfile
# container/Dockerfile
FROM node:22-slim

RUN groupadd -g 1000 agent 2>/dev/null || true && useradd -u 1000 -g agent -m agent 2>/dev/null || true

WORKDIR /app/agent-runner
COPY agent-runner/dist/ ./dist/
COPY agent-runner/node_modules/ ./node_modules/
COPY agent-runner/package.json ./

USER agent
ENTRYPOINT ["node", "/app/agent-runner/dist/index.js"]
```

```bash
#!/bin/bash
# container/build.sh — builds and tags with three tags:
# cueclaw-agent:latest, ghcr.io/memodb-io/cueclaw-agent:latest, ghcr.io/memodb-io/cueclaw-agent:{version}
set -euo pipefail

cd "$(dirname "$0")/agent-runner"
pnpm install
pnpm build

cd ..
VERSION=$(node -e "console.log(require('../package.json').version)")
docker build -t cueclaw-agent:latest \
  -t ghcr.io/memodb-io/cueclaw-agent:latest \
  -t "ghcr.io/memodb-io/cueclaw-agent:${VERSION}" .
echo "Container image built: cueclaw-agent:latest (+ GHCR tags for v${VERSION})"
```

**Container agent-runner package.json:**

```json
{
  "name": "cueclaw-agent-runner",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "tsup src/index.ts src/ipc-mcp-stdio.ts --format esm --target node22"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "latest",
    "@modelcontextprotocol/sdk": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "tsup": "latest",
    "typescript": "latest",
    "@types/node": "latest"
  }
}
```

### 2.8 Setup CLI (`src/setup-*.ts`)

> **Implementation note:** Setup files are flat in `src/` (not a `setup/` subdirectory), following the project's flat layout convention.

First-run setup wizard accessible via `cueclaw setup`.

- [x] `src/setup.ts` — orchestrates all setup steps (`runSetup(config, projectRoot)`)
- [x] `src/setup-environment.ts` — check Docker installed (`docker --version`) and running (`docker info`)
- [x] `src/setup-container.ts` — build container image (`container/build.sh`)
- [x] `src/setup-auth.ts` — validate API key works (test API call)
- [x] `src/setup-verify.ts` — smoke test: spawn container, verify Node.js runs
- [x] Register `cueclaw setup` command in CLI

```typescript
// setup/index.ts
export async function runSetup(config: CueclawConfig): Promise<void> {
  console.log('CueClaw Setup\n')

  // 1. Check environment
  console.log('Checking environment...')
  await checkEnvironment()  // Docker, Node version

  // 2. Build container
  console.log('Building container image...')
  await buildContainer()

  // 3. Validate auth
  console.log('Validating API key...')
  await validateAuth(config)

  // 4. Smoke test
  console.log('Running smoke test...')
  await runSmokeTest(config)

  console.log('\n✓ Setup complete. Run `cueclaw daemon install` to start the background service.')
}
```

### 2.9 Docker Image Management (`src/container-runtime.ts`)

Ensures the container image is available before execution — auto-builds in dev, auto-pulls in production.

- [x] `isDockerImageAvailable(image)` — `docker image inspect`, cached per image
- [x] `ensureDockerImage(image)` — checks local cache, then:
  - Dev mode (`isDev=true`): runs `container/build.sh` via `buildDevImage()`
  - Production: attempts `docker pull` with 5-minute timeout
- [x] `buildDevImage(image)` — resolves `container/build.sh` relative to `import.meta.url`, runs with `stdio: 'inherit'`
- [x] `getDefaultImage()` in `config.ts` — dev returns `'cueclaw-agent:latest'`, prod returns `'ghcr.io/memodb-io/cueclaw-agent:{version}'`
- [x] Agent runner calls `ensureDockerImage()` before container execution — falls back to local execution if unavailable

### 2.10 Agent Runner Mode Switch (`src/agent-runner.ts`)

Update the existing agent runner to support both local and container execution.

- [x] Check `config.container.enabled` to decide mode
- [x] Container mode: delegate to `runContainerAgent()` from `container-runner.ts`
- [x] Local mode: existing `query()` call with `localSafetyGuard` hooks
- [x] Same return type — transparent to the Executor

```typescript
// src/agent-runner.ts — updated
import { runContainerAgent } from './container-runner.js'

export function runAgent(opts: {
  prompt: string
  cwd: string
  workflowId: string
  stepId: string
  runId: string
  sessionId?: string
  allowedTools?: string[]
  signal?: AbortSignal
  onProgress?: (msg: any) => void
}): { queryRef: Query; resultPromise: Promise<StepRunResult> } {
  const config = loadConfig()

  if (config.container?.enabled) {
    // Container mode — full OS-level isolation
    const ipcDir = join(cueclawHome(), 'ipc', opts.workflowId, opts.stepId)
    const workDir = join(cueclawHome(), 'work', opts.workflowId, opts.stepId)
    mkdirSync(workDir, { recursive: true })
    mkdirSync(join(ipcDir, 'input'), { recursive: true })
    mkdirSync(join(ipcDir, 'output'), { recursive: true })

    // Container mode returns a stub queryRef that calls `docker stop` on interrupt()
    const containerName = `cueclaw-${opts.workflowId}-${opts.stepId}-${Date.now()}`
    const queryRef = {
      interrupt: () => { spawn('docker', ['stop', containerName]) },
    } as Query

    const resultPromise = runContainerAgent({
      workflowId: opts.workflowId,
      stepId: opts.stepId,
      runId: opts.runId,
      prompt: opts.prompt,
      cwd: opts.cwd,
      workDir,
      ipcDir,
      containerName,
      allowedTools: opts.allowedTools,
      signal: opts.signal,
      onProgress: opts.onProgress ? (output) => opts.onProgress!(output) : undefined,
    })

    return { queryRef, resultPromise }
  }

  // Local mode — app-level safety hooks only
  // ... existing query() code unchanged ...
}
```

---

## Config Additions

Add to `~/.cueclaw/config.yaml`:

```yaml
container:
  enabled: false                   # Default: false. Set true = container execution with Docker isolation
  image: ghcr.io/memodb-io/cueclaw-agent:0.1.2  # Default: version-pinned via getDefaultImage()
                                   # Dev mode defaults to 'cueclaw-agent:latest' (local build)
  timeout: 1800000                 # 30 min hard timeout per step
  max_output_size: 10485760        # 10MB output cap
  idle_timeout: 1800000            # 30 min idle timeout
```

Add to Zod config schema (`src/config.ts`):

```typescript
container: z.object({
  enabled: z.boolean().default(false),
  image: z.string().default(getDefaultImage()),  // Dev: 'cueclaw-agent:latest', Prod: 'ghcr.io/memodb-io/cueclaw-agent:{version}'
  timeout: z.number().default(1_800_000),
  max_output_size: z.number().default(10_485_760),
  idle_timeout: z.number().default(1_800_000),
  network: z.enum(['none', 'host', 'bridge']).default('none'),
}).optional(),
```

---

## Acceptance Criteria

- [x] `cueclaw setup` validates Docker, builds container image, runs smoke test
- [x] Container starts with correct mount strategy (project read-only, work writable, IPC mounted)
- [x] Stdin JSON protocol delivers step input to container agent
- [x] Container agent executes Claude Agent SDK `query()` and streams output via markers
- [x] IPC round-trip works: container writes to output/, host reads and processes
- [x] MCP tools (`cueclaw_report_progress`, `cueclaw_notify`, `cueclaw_get_context`) work inside container
- [x] Mount allowlist blocks access to `.ssh`, `.gnupg`, `.aws` and other sensitive directories
- [x] Container hard timeout works: graceful `docker stop` → SIGKILL
- [x] Container idle timeout works: kills container after inactivity
- [x] Output size cap prevents memory exhaustion (truncation at 10MB)
- [x] `runAgent()` transparently switches between local and container mode based on config
- [x] All existing Phase 1 tests pass (local mode unchanged)
- [x] Container-specific tests pass with Docker available
- [x] Non-root user execution inside container
- [x] No network access by default (`--network none`)
- [x] Secrets not exposed as environment variables (stdin-only delivery)

---

## Dependencies to Install

```bash
# Host-side (main package.json)
pnpm add @modelcontextprotocol/sdk

# Container (container/agent-runner/package.json)
cd container/agent-runner
pnpm add @anthropic-ai/claude-agent-sdk @modelcontextprotocol/sdk zod
pnpm add -D tsup typescript @types/node
```

---

## What This Unlocks

Phase 2 completes the security model:
- **Phase 3** (TUI) and **Phase 4** (Bots) benefit from secure container execution without any changes
- **Phase 5** (Daemon) runs containers in the background with full isolation
- **Phase 6** (Validation) can test both local and container modes
- Future: per-workflow container configs, custom images, network policies
