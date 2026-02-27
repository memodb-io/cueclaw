import { loadConfig, getDefaultImage } from './config.js'
import { checkBashSafety } from './hooks.js'
import { runContainerAgent, prepareContainerOpts } from './container-runner.js'
import { isDockerAvailable, ensureDockerImage } from './container-runtime.js'
import { logger } from './logger.js'
import type { StepStatus } from './types.js'

export interface StepRunResult {
  status: StepStatus
  output?: string | null
  error?: string
  sessionId?: string
}

export interface AgentHandle {
  resultPromise: Promise<StepRunResult>
  abort: () => void
}

/** Run an agent step. Automatically chooses between container and local mode based on config.
 *  Returns a handle with the result promise and an abort function. */
export function runAgent(opts: {
  prompt: string
  cwd: string
  workflowId?: string
  stepId?: string
  runId?: string
  sessionId?: string
  allowedTools?: string[]
  signal?: AbortSignal
  onProgress?: (msg: any) => void
}): AgentHandle {
  const config = loadConfig()

  // Container mode: opt-in — enable via config.yaml container.enabled: true
  const containerEnabled = config.container?.enabled ?? false
  if (containerEnabled && opts.workflowId && opts.stepId && opts.runId) {
    if (!isDockerAvailable()) {
      logger.warn({ stepId: opts.stepId }, 'Docker not available, falling back to local execution')
    } else if (!ensureDockerImage(config.container?.image ?? getDefaultImage())) {
      logger.warn({ stepId: opts.stepId, image: config.container?.image ?? getDefaultImage() }, 'Docker image not available (pull failed), falling back to local execution')
    } else {
      logger.info({ stepId: opts.stepId, mode: 'container' }, 'Running agent in container mode')
      const containerOpts = prepareContainerOpts(
        opts.workflowId, opts.stepId, opts.runId,
        opts.prompt, opts.cwd, opts.allowedTools,
      )
      const resultPromise = runContainerAgent({
        ...containerOpts,
        signal: opts.signal,
        onProgress: opts.onProgress,
      })
      return {
        resultPromise,
        abort: () => {
          try {
            import('node:child_process').then(({ spawn }) => {
              spawn('docker', ['stop', containerOpts.containerName])
            })
          } catch { /* best-effort */ }
        },
      }
    }
  }

  // Local mode
  logger.info({ stepId: opts.stepId, mode: 'local' }, 'Running agent in local mode')
  let aborted = false

  const resultPromise = (async (): Promise<StepRunResult> => {
    // Set executor-specific env vars for the Claude Code subprocess
    const authToken = config.claude.executor.api_key ?? config.claude.api_key
    const baseUrl = config.claude.executor.base_url ?? config.claude.base_url
    const prevAuthToken = process.env['ANTHROPIC_AUTH_TOKEN']
    const prevBaseUrl = process.env['ANTHROPIC_BASE_URL']
    process.env['ANTHROPIC_AUTH_TOKEN'] = authToken
    if (baseUrl !== 'https://api.anthropic.com') {
      process.env['ANTHROPIC_BASE_URL'] = baseUrl
    }

    try {
      // Dynamic import to allow mocking in tests
      const { query } = await import('@anthropic-ai/claude-agent-sdk')

      const permMode = config.claude.executor.skip_permissions
        ? 'dangerously-skip-permissions' : 'default'

      const q = query({
        prompt: opts.prompt,
        options: {
          cwd: opts.cwd,
          model: config.claude.executor.model,
          resume: opts.sessionId,
          allowedTools: opts.allowedTools ?? [
            'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
            'WebSearch', 'WebFetch',
          ],
          settingSources: ['project'],
          permissionMode: permMode,
        },
      })

      let sessionId: string | undefined
      let result: string | null = null

      for await (const message of q) {
        if (aborted) {
          if ('interrupt' in q && typeof (q as any).interrupt === 'function') {
            (q as any).interrupt()
          }
          return { status: 'failed', error: 'Aborted by user' }
        }

        if (message.type === 'system' && message.subtype === 'init') {
          sessionId = (message as any).session_id
        }

        // Check for bash safety in local mode — block dangerous commands
        if (message.type === 'assistant') {
          for (const block of (message as any).content ?? []) {
            if (block.type === 'tool_use' && block.name === 'Bash') {
              const cmd = block.input?.command as string | undefined
              if (cmd) {
                const check = checkBashSafety(cmd)
                if (!check.allowed) {
                  logger.warn({ command: cmd, reason: check.reason }, 'Blocked dangerous command')
                  return { status: 'failed', error: `Blocked dangerous command: ${check.reason}` }
                }
              }
            }
          }
        }

        if ('result' in message) {
          result = (message as any).result ?? null
        }

        opts.onProgress?.(message)
      }

      logger.debug({ stepId: opts.stepId, status: 'succeeded' }, 'Agent completed')
      return { status: 'succeeded', output: result, sessionId }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.error({ err, stepId: opts.stepId }, 'Agent execution failed')
      return { status: 'failed', error: errorMsg }
    } finally {
      // Restore previous env vars
      if (prevAuthToken !== undefined) process.env['ANTHROPIC_AUTH_TOKEN'] = prevAuthToken
      else delete process.env['ANTHROPIC_AUTH_TOKEN']
      if (prevBaseUrl !== undefined) process.env['ANTHROPIC_BASE_URL'] = prevBaseUrl
      else delete process.env['ANTHROPIC_BASE_URL']
    }
  })()

  return {
    resultPromise,
    abort: () => { aborted = true },
  }
}
