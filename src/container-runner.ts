import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, cueclawHome } from './config.js'
import { loadMountAllowlist, validateAdditionalMounts, expandHome } from './mount-security.js'
import { IpcWatcher, type IpcMessage } from './ipc.js'
import { McpMessageHandler, type MessageRouter } from './mcp-server.js'
import { logger } from './logger.js'
import type { AdditionalMount } from './types.js'
import type { StepRunResult } from './agent-runner.js'

const OUTPUT_START_MARKER = '---CUECLAW_OUTPUT_START---'
const OUTPUT_END_MARKER = '---CUECLAW_OUTPUT_END---'

interface ContainerInput {
  prompt: string
  workflowId: string
  stepId: string
  runId: string
  apiKey: string
  allowedTools?: string[]
}

export interface ContainerRunnerOpts {
  workflowId: string
  stepId: string
  runId: string
  prompt: string
  cwd: string
  workDir: string
  ipcDir: string
  containerName: string
  allowedTools?: string[]
  additionalMounts?: AdditionalMount[]
  signal?: AbortSignal
  onProgress?: (output: any) => void
  db?: import('better-sqlite3').Database
  router?: MessageRouter
}

export async function runContainerAgent(opts: ContainerRunnerOpts): Promise<StepRunResult> {
  const config = loadConfig()
  const allowlist = loadMountAllowlist()

  if (opts.additionalMounts) {
    validateAdditionalMounts(opts.additionalMounts, allowlist)
  }

  // Ensure directories exist
  mkdirSync(opts.workDir, { recursive: true })
  mkdirSync(join(opts.ipcDir, 'input'), { recursive: true })
  mkdirSync(join(opts.ipcDir, 'output'), { recursive: true })

  // Build Docker args
  const image = config.container?.image ?? 'cueclaw-agent:latest'
  const network = config.container?.network ?? 'none'
  const volumeMounts = buildVolumeMounts(opts)

  const dockerArgs = [
    'run', '--rm', '-i',
    '--name', opts.containerName,
    '--network', network,
    '--user', '1000:1000',
    '--memory', '4g',
    '--cpus', '2',
    ...volumeMounts,
    image,
  ]

  // Start IPC watcher if db and router available
  let ipcWatcher: IpcWatcher | undefined
  if (opts.db && opts.router) {
    ipcWatcher = new IpcWatcher(opts.workflowId, opts.stepId, opts.ipcDir, (msg: IpcMessage) => {
      const handler = new McpMessageHandler(opts.db!, opts.router!, ipcWatcher!)
      handler.handle(msg)
    })
    ipcWatcher.start()
  }

  try {
    const result = await spawnContainer(dockerArgs, opts, config)
    return result
  } finally {
    ipcWatcher?.stop()
  }
}

function buildVolumeMounts(opts: ContainerRunnerOpts): string[] {
  const mounts = [
    '-v', `${opts.cwd}:/workspace/project:ro`,
    '-v', `${opts.workDir}:/workspace/work`,
    '-v', `${opts.ipcDir}:/workspace/ipc`,
  ]

  for (const mount of opts.additionalMounts ?? []) {
    const expanded = expandHome(mount.hostPath)
    const containerPath = mount.containerPath ?? `/workspace/mounts${expanded}`
    const mode = mount.readonly !== false ? 'ro' : 'rw'
    mounts.push('-v', `${expanded}:${containerPath}:${mode}`)
  }

  return mounts
}

async function spawnContainer(
  dockerArgs: string[],
  opts: ContainerRunnerOpts,
  config: ReturnType<typeof loadConfig>,
): Promise<StepRunResult> {
  return new Promise((resolve) => {
    const proc = spawn('docker', dockerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Send input via stdin
    const input: ContainerInput = {
      prompt: opts.prompt,
      workflowId: opts.workflowId,
      stepId: opts.stepId,
      runId: opts.runId,
      apiKey: config.claude.api_key,
      allowedTools: opts.allowedTools,
    }
    proc.stdin.write(JSON.stringify(input))
    proc.stdin.end()

    // Timeout management
    const hardTimeout = config.container?.timeout ?? 1_800_000
    const idleTimeout = config.container?.idle_timeout ?? 1_800_000
    const maxOutputSize = config.container?.max_output_size ?? 10_485_760
    let lastActivity = Date.now()
    let totalOutput = 0
    let truncated = false

    const hardTimer = setTimeout(() => {
      logger.warn({ containerName: opts.containerName }, 'Container hard timeout reached')
      gracefulStop(opts.containerName)
    }, hardTimeout)

    const idleCheck = setInterval(() => {
      if (Date.now() - lastActivity > idleTimeout) {
        logger.warn({ containerName: opts.containerName }, 'Container idle timeout reached')
        gracefulStop(opts.containerName)
      }
    }, 10_000)

    opts.signal?.addEventListener('abort', () => gracefulStop(opts.containerName), { once: true })

    // Capture stdout
    let stdout = ''
    let resultBuffer = ''

    proc.stdout?.on('data', (chunk: Buffer) => {
      lastActivity = Date.now()
      const text = chunk.toString()

      totalOutput += text.length
      if (totalOutput > maxOutputSize) {
        if (!truncated) {
          truncated = true
          logger.warn({ containerName: opts.containerName, size: totalOutput }, 'Container output size cap reached, stopping container')
          gracefulStop(opts.containerName)
        }
        return
      }

      stdout += text
      opts.onProgress?.({ type: 'output', data: text })
    })

    let stderr = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      lastActivity = Date.now()
      stderr += chunk.toString()
    })

    proc.on('close', (code) => {
      clearTimeout(hardTimer)
      clearInterval(idleCheck)

      if (truncated) {
        resolve({ status: 'failed', error: 'Container output size cap exceeded' })
        return
      }

      // Parse output markers
      const startIdx = stdout.indexOf(OUTPUT_START_MARKER)
      const endIdx = stdout.indexOf(OUTPUT_END_MARKER)

      if (startIdx !== -1 && endIdx !== -1) {
        resultBuffer = stdout.slice(startIdx + OUTPUT_START_MARKER.length + 1, endIdx).trim()
      }

      if (code !== 0 && !resultBuffer) {
        resolve({
          status: 'failed',
          error: stderr || `Container exited with code ${code}`,
        })
        return
      }

      try {
        const parsed = JSON.parse(resultBuffer)
        resolve({
          status: 'succeeded',
          output: parsed.result ?? null,
          sessionId: parsed.sessionId,
        })
      } catch {
        if (resultBuffer) {
          resolve({ status: 'succeeded', output: resultBuffer })
        } else {
          resolve({
            status: 'failed',
            error: stderr || 'No output captured from container',
          })
        }
      }
    })

    proc.on('error', (err) => {
      clearTimeout(hardTimer)
      clearInterval(idleCheck)
      resolve({
        status: 'failed',
        error: `Docker spawn error: ${err.message}`,
      })
    })
  })
}

function gracefulStop(containerName: string): void {
  try {
    spawn('docker', ['stop', containerName])
  } catch {
    // Best-effort stop
  }
}

/** Prepare directories and return opts for container execution */
export function prepareContainerOpts(
  workflowId: string,
  stepId: string,
  runId: string,
  prompt: string,
  cwd: string,
  allowedTools?: string[],
): Omit<ContainerRunnerOpts, 'containerName'> & { containerName: string } {
  const ipcDir = join(cueclawHome(), 'ipc', workflowId, stepId)
  const workDir = join(cueclawHome(), 'work', workflowId, stepId)
  const containerName = `cueclaw-${workflowId}-${stepId}-${Date.now()}`

  mkdirSync(workDir, { recursive: true })
  mkdirSync(join(ipcDir, 'input'), { recursive: true })
  mkdirSync(join(ipcDir, 'output'), { recursive: true })

  return {
    workflowId, stepId, runId, prompt, cwd,
    workDir, ipcDir, containerName, allowedTools,
  }
}
