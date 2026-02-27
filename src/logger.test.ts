import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initLogger, resetLogger, enableTuiLogging, createExecutionLogger, logger, onLogLine } from './logger.js'

describe('logger', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'cueclaw-logger-test-'))
  })

  afterEach(() => {
    resetLogger()
  })

  describe('initLogger', () => {
    it('sets log level correctly', () => {
      initLogger({ level: 'warn', dir: testDir })
      expect(logger.level).toBe('warn')
    })

    it('defaults to info level', () => {
      initLogger({ dir: testDir })
      expect(logger.level).toBe('info')
    })

    it('creates daemon.log and executions/ directory', () => {
      initLogger({ dir: testDir })
      expect(existsSync(join(testDir, 'executions'))).toBe(true)

      // Write a log line and verify it arrives in the file
      logger.info('test message')

      // pino writes asynchronously via the stream — flush by ending
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const content = readFileSync(join(testDir, 'daemon.log'), 'utf-8')
          expect(content).toContain('test message')
          resolve()
        }, 100)
      })
    })

    it('works without dir (level-only update)', () => {
      initLogger({ level: 'debug' })
      expect(logger.level).toBe('debug')
    })
  })

  describe('enableTuiLogging', () => {
    it('preserves file logging after initLogger', () => {
      initLogger({ dir: testDir })
      enableTuiLogging()

      // Logger should still write to daemon.log
      logger.info('tui-and-file-test')

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const content = readFileSync(join(testDir, 'daemon.log'), 'utf-8')
          expect(content).toContain('tui-and-file-test')
          resolve()
        }, 100)
      })
    })

    it('sends log lines to TUI listeners', () => {
      enableTuiLogging()
      const lines: string[] = []
      const unsub = onLogLine((line) => lines.push(line))

      logger.info('hello tui')

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(lines.some(l => l.includes('hello tui'))).toBe(true)
          unsub()
          resolve()
        }, 100)
      })
    })
  })

  describe('createExecutionLogger', () => {
    it('creates log file under executions/ subdirectory', () => {
      initLogger({ dir: testDir })
      const execLog = createExecutionLogger('wf_test123', 'run_abc')

      execLog.info('step execution log')

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const date = new Date().toISOString().slice(0, 10)
          const logPath = join(testDir, 'executions', `wf_test123_${date}.log`)
          expect(existsSync(logPath)).toBe(true)
          const content = readFileSync(logPath, 'utf-8')
          expect(content).toContain('step execution log')
          resolve()
        }, 100)
      })
    })

    it('falls back to child logger when no dir configured', () => {
      const execLog = createExecutionLogger('wf_test', 'run_test')
      // Should not throw and should be a valid pino logger
      expect(typeof execLog.info).toBe('function')
      expect(typeof execLog.error).toBe('function')
    })
  })

  describe('resetLogger', () => {
    it('cleans up state so subsequent initLogger starts fresh', () => {
      initLogger({ level: 'warn', dir: testDir })
      expect(logger.level).toBe('warn')

      resetLogger()
      expect(logger.level).toBe('info')

      // After reset, createExecutionLogger should fall back (no dir)
      const execLog = createExecutionLogger('wf_x', 'run_x')
      expect(typeof execLog.info).toBe('function')
    })
  })
})
