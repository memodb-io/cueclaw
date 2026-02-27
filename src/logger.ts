import pino from 'pino'
import { PassThrough } from 'node:stream'
import { createWriteStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { WriteStream } from 'node:fs'

type LogListener = (line: string) => void
const listeners: Set<LogListener> = new Set()
const tuiStream = new PassThrough()

tuiStream.on('data', (chunk: Buffer) => {
  for (const raw of chunk.toString().split('\n')) {
    if (!raw.trim()) continue
    try {
      const obj = JSON.parse(raw)
      const lvl = (pino.levels.labels[obj.level] ?? 'INFO').toUpperCase()
      const mod = obj.module ? ` [${obj.module}]` : ''
      const msg = obj.msg ?? ''
      for (const fn of listeners) fn(`${lvl}${mod} ${msg}`)
    } catch {
      for (const fn of listeners) fn(raw)
    }
  }
})

// Module-level state for file logging
let fileStream: WriteStream | null = null
let logDir: string | null = null
let configuredLevel: string | null = null

function resolveDir(dir: string): string {
  return dir.startsWith('~') ? join(homedir(), dir.slice(1)) : dir
}

function getLevel(): pino.LevelWithSilentOrString {
  return configuredLevel ?? process.env['LOG_LEVEL'] ?? 'info'
}

export let logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: process.env['NODE_ENV'] === 'production'
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true } },
})

/**
 * Initialize file-based logging. Call after config is loaded.
 * Creates log directory, opens daemon.log, and reconfigures the logger
 * to write to both stdout and the file.
 */
export function initLogger(opts: { level?: string; dir?: string }): void {
  const level = opts.level ?? process.env['LOG_LEVEL'] ?? 'info'
  configuredLevel = level

  if (opts.dir) {
    const resolved = resolveDir(opts.dir)
    logDir = resolved
    mkdirSync(join(resolved, 'executions'), { recursive: true })

    fileStream = createWriteStream(join(resolved, 'daemon.log'), { flags: 'a' })

    logger = pino(
      { level },
      pino.multistream([
        { stream: process.stdout },
        { stream: fileStream },
      ]),
    )
  } else {
    // No dir configured — just update level
    logger = pino({
      level,
      transport: process.env['NODE_ENV'] === 'production'
        ? undefined
        : { target: 'pino-pretty', options: { colorize: true } },
    })
  }
}

/**
 * Switch logger to TUI mode: writes to in-memory stream instead of stdout.
 * If initLogger() was called with a dir, also writes to the file stream.
 * Must be called before TUI renders.
 */
export function enableTuiLogging(): void {
  if (fileStream) {
    logger = pino(
      { level: getLevel() },
      pino.multistream([
        { stream: tuiStream },
        { stream: fileStream },
      ]),
    )
  } else {
    logger = pino({ level: getLevel() }, tuiStream)
  }
}

/**
 * Subscribe to formatted log lines (TUI mode only).
 * Returns an unsubscribe function.
 */
export function onLogLine(fn: LogListener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function createChildLogger(bindings: Record<string, any>): pino.Logger {
  return logger.child(bindings)
}

/**
 * Create an execution-specific logger that writes to a per-workflow log file.
 * Only creates a file logger if initLogger() was called with a dir.
 * Falls back to a child of the main logger otherwise.
 */
export function createExecutionLogger(workflowId: string, runId: string): pino.Logger {
  if (!logDir) {
    return logger.child({ workflowId, runId })
  }

  const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const filename = `${workflowId}_${date}.log`
  const execStream = createWriteStream(join(logDir, 'executions', filename), { flags: 'a' })

  return pino(
    { level: getLevel() },
    pino.multistream([
      { stream: execStream },
      ...(fileStream ? [{ stream: fileStream }] : []),
    ]),
  )
}

/**
 * Reset logger state for test isolation.
 */
export function resetLogger(): void {
  if (fileStream) {
    fileStream.end()
    fileStream = null
  }
  logDir = null
  configuredLevel = null
  logger = pino({
    level: process.env['LOG_LEVEL'] ?? 'info',
    transport: process.env['NODE_ENV'] === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true } },
  })
}
