import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { diffNewItems, evaluatePollTrigger } from './trigger.js'
import { _initTestDatabase, insertWorkflow } from './db.js'
import type Database from 'better-sqlite3'
import type { Workflow } from './types.js'

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('node:util', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:util')>()
  return {
    ...original,
    promisify: (_fn: unknown) => {
      return async (...args: unknown[]) => {
        const { execFile } = await import('node:child_process')
        return new Promise((resolve, reject) => {
          (execFile as any)(...args, (err: unknown, stdout: string, stderr: string) => {
            if (err) reject(err)
            else resolve({ stdout, stderr })
          })
        })
      }
    },
  }
})

describe('trigger', () => {
  describe('evaluatePollTrigger', () => {
    let db: Database.Database

    beforeEach(() => {
      db = _initTestDatabase()
    })

    afterEach(() => {
      db.close()
      vi.restoreAllMocks()
    })

    function makeWorkflow(id: string): Workflow {
      return {
        id,
        name: 'Test',
        description: 'test',
        trigger: { type: 'poll' as const, interval_seconds: 60, check_script: 'echo test', diff_mode: 'any_change' as const },
        steps: [],
        failure_policy: { on_step_failure: 'stop' as const, max_retries: 0, retry_delay_ms: 5000 },
        phase: 'active' as const,
        schema_version: '1.0' as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    }

    it('returns trigger data when output changes', async () => {
      const { execFile } = await import('node:child_process')
      ;(execFile as any).mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...a: unknown[]) => void) => {
        cb(null, 'new-output\n', '')
      })

      const workflow = makeWorkflow('wf_test')
      insertWorkflow(db, workflow)

      const result = await evaluatePollTrigger(workflow, workflow.trigger as any, db)
      expect(result).not.toBeNull()
      expect(result!.data).toBe('new-output')
    })

    it('returns null when output has not changed', async () => {
      const { execFile } = await import('node:child_process')
      ;(execFile as any).mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...a: unknown[]) => void) => {
        cb(null, 'same-output\n', '')
      })

      const workflow = makeWorkflow('wf_test2')
      insertWorkflow(db, workflow)

      // First call sets baseline
      await evaluatePollTrigger(workflow, workflow.trigger as any, db)
      // Second call should return null (no change)
      const result = await evaluatePollTrigger(workflow, workflow.trigger as any, db)
      expect(result).toBeNull()
    })

    it('returns null and logs error on script failure', async () => {
      const { execFile } = await import('node:child_process')
      ;(execFile as any).mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...a: unknown[]) => void) => {
        cb(new Error('Script failed'), '', '')
      })

      const workflow = makeWorkflow('wf_test3')
      insertWorkflow(db, workflow)

      const result = await evaluatePollTrigger(workflow, workflow.trigger as any, db)
      expect(result).toBeNull()

      // Verify error was saved to trigger_state
      const state = db.prepare('SELECT last_error FROM trigger_state WHERE workflow_id = ?').get('wf_test3') as any
      expect(state.last_error).toContain('Script failed')
    })
  })

  describe('diffNewItems', () => {
    it('returns all items when old is null', () => {
      const result = diffNewItems(null, 'a\nb\nc')
      expect(result).toEqual(['a', 'b', 'c'])
    })

    it('returns only new items', () => {
      const result = diffNewItems('a\nb', 'a\nb\nc\nd')
      expect(result).toEqual(['c', 'd'])
    })

    it('returns empty when no new items', () => {
      const result = diffNewItems('a\nb', 'a\nb')
      expect(result).toEqual([])
    })

    it('handles empty new output', () => {
      const result = diffNewItems('a\nb', '')
      expect(result).toEqual([])
    })

    it('filters empty lines', () => {
      const result = diffNewItems(null, 'a\n\nb\n\n')
      expect(result).toEqual(['a', 'b'])
    })
  })
})
