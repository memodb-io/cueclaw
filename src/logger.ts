import pino from 'pino'
import { PassThrough } from 'node:stream'

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

export let logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: process.env['NODE_ENV'] === 'production'
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true } },
})

/**
 * Switch logger to TUI mode: writes to in-memory stream instead of stdout.
 * Must be called before TUI renders.
 */
export function enableTuiLogging(): void {
  logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' }, tuiStream)
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
