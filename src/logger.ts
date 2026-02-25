import pino from 'pino'

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: process.env['NODE_ENV'] === 'production'
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true } },
})

export function createChildLogger(bindings: Record<string, any>): pino.Logger {
  return logger.child(bindings)
}
