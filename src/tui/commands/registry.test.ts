import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseSlashCommand, findCommand, getCommands } from './index.js'
import type { CommandContext } from './types.js'
import { _initTestDatabase } from '../../db.js'
import { insertWorkflow } from '../../db.js'
import type { Workflow } from '../../types.js'
import type Database from 'better-sqlite3'

// ─── parseSlashCommand ───

describe('parseSlashCommand', () => {
  it('returns null for non-slash input', () => {
    expect(parseSlashCommand('hello world')).toBeNull()
    expect(parseSlashCommand('  not a command')).toBeNull()
    expect(parseSlashCommand('')).toBeNull()
  })

  it('parses command without args', () => {
    expect(parseSlashCommand('/help')).toEqual({ name: 'help', args: '' })
    expect(parseSlashCommand('/list')).toEqual({ name: 'list', args: '' })
    expect(parseSlashCommand('  /clear  ')).toEqual({ name: 'clear', args: '' })
  })

  it('parses command with args', () => {
    expect(parseSlashCommand('/status wf_123')).toEqual({ name: 'status', args: 'wf_123' })
    expect(parseSlashCommand('/config set claude.model gpt-4')).toEqual({ name: 'config', args: 'set claude.model gpt-4' })
    expect(parseSlashCommand('/new monitor my repo')).toEqual({ name: 'new', args: 'monitor my repo' })
  })
})

// ─── findCommand ───

describe('findCommand', () => {
  it('finds command by name', () => {
    expect(findCommand('help')).toBeDefined()
    expect(findCommand('list')).toBeDefined()
    expect(findCommand('status')).toBeDefined()
  })

  it('finds command by alias', () => {
    expect(findCommand('h')).toBeDefined()
    expect(findCommand('h')?.name).toBe('help')
    expect(findCommand('ls')?.name).toBe('list')
    expect(findCommand('st')?.name).toBe('status')
    expect(findCommand('rm')?.name).toBe('delete')
    expect(findCommand('cfg')?.name).toBe('config')
    expect(findCommand('cls')?.name).toBe('clear')
  })

  it('returns undefined for unknown commands', () => {
    expect(findCommand('unknown')).toBeUndefined()
    expect(findCommand('xyz')).toBeUndefined()
  })

  it('is case insensitive', () => {
    expect(findCommand('HELP')).toBeDefined()
    expect(findCommand('Help')?.name).toBe('help')
  })
})

// ─── getCommands ───

describe('getCommands', () => {
  it('returns all registered commands covering CLI parity', () => {
    const cmds = getCommands()
    expect(cmds.length).toBeGreaterThanOrEqual(15)
    const names = cmds.map(c => c.name)
    // Core commands
    expect(names).toContain('help')
    expect(names).toContain('list')
    expect(names).toContain('status')
    expect(names).toContain('pause')
    expect(names).toContain('resume')
    expect(names).toContain('delete')
    expect(names).toContain('config')
    expect(names).toContain('daemon')
    expect(names).toContain('info')
    expect(names).toContain('clear')
    expect(names).toContain('cancel')
    // CLI-parity commands
    expect(names).toContain('new')
    expect(names).toContain('bot')
    expect(names).toContain('setup')
    // New theme command
    expect(names).toContain('theme')
  })
})

// ─── Command execution ───

function makeTestWorkflow(overrides?: Partial<Workflow>): Workflow {
  const now = new Date().toISOString()
  return {
    id: 'wf_test123',
    name: 'Test Workflow',
    description: 'A test workflow',
    schema_version: '1.0',
    phase: 'active',
    trigger: { type: 'manual' },
    steps: [
      { id: 'step-1', description: 'Step 1', agent: 'claude', inputs: {}, depends_on: [] },
    ],
    failure_policy: { on_step_failure: 'stop', max_retries: 0, retry_delay_ms: 0 },
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function makeContext(db: Database.Database): { ctx: CommandContext; messages: any[] } {
  const messages: any[] = []
  const ctx: CommandContext = {
    db,
    config: null,
    cwd: '/tmp/test',
    bridge: null,
    addMessage: (msg) => messages.push(msg),
    clearMessages: () => messages.length = 0,
    setConfig: vi.fn(),
    setThemeVersion: vi.fn(),
  }
  return { ctx, messages }
}

describe('command execution', () => {
  let db: Database.Database

  beforeEach(() => {
    db = _initTestDatabase()
  })

  it('/help lists all commands', () => {
    const { ctx, messages } = makeContext(db)
    findCommand('help')!.execute('', ctx)
    expect(messages).toHaveLength(1)
    expect(messages[0].type).toBe('assistant')
    expect(messages[0].text).toContain('/help')
    expect(messages[0].text).toContain('/list')
  })

  // /list, /status, /clear, /cancel, /new, /bot, /setup are handled in use-command-dispatch.ts
  // Their execute() bodies are no-ops — just verify registration
  it('/list is registered and execute is a no-op', () => {
    const { ctx, messages } = makeContext(db)
    findCommand('list')!.execute('', ctx)
    expect(messages).toHaveLength(0)
  })

  it('/status is registered and execute is a no-op', () => {
    const { ctx, messages } = makeContext(db)
    findCommand('status')!.execute('', ctx)
    expect(messages).toHaveLength(0)
  })

  it('/pause validates workflow phase', () => {
    const wf = makeTestWorkflow({ phase: 'completed' })
    insertWorkflow(db, wf)
    const { ctx, messages } = makeContext(db)
    findCommand('pause')!.execute('wf_test123', ctx)
    expect(messages[0].text).toContain('Cannot pause')
  })

  it('/pause succeeds on active workflow', () => {
    const wf = makeTestWorkflow({ phase: 'active' })
    insertWorkflow(db, wf)
    const { ctx, messages } = makeContext(db)
    findCommand('pause')!.execute('wf_test123', ctx)
    expect(messages[0].text).toContain('Paused')
  })

  it('/resume validates workflow phase', () => {
    const wf = makeTestWorkflow({ phase: 'active' })
    insertWorkflow(db, wf)
    const { ctx, messages } = makeContext(db)
    findCommand('resume')!.execute('wf_test123', ctx)
    expect(messages[0].text).toContain('Cannot resume')
  })

  it('/delete removes workflow', () => {
    const wf = makeTestWorkflow({ phase: 'completed' })
    insertWorkflow(db, wf)
    const { ctx, messages } = makeContext(db)
    findCommand('delete')!.execute('wf_test123', ctx)
    expect(messages[0].text).toContain('Deleted')
  })

  it('/delete rejects executing workflow', () => {
    const wf = makeTestWorkflow({ phase: 'executing' })
    insertWorkflow(db, wf)
    const { ctx, messages } = makeContext(db)
    findCommand('delete')!.execute('wf_test123', ctx)
    expect(messages[0].text).toContain('Cannot delete')
  })

  it('/clear is registered and execute is a no-op', () => {
    const { ctx, messages } = makeContext(db)
    messages.push({ type: 'user', text: 'hello' })
    findCommand('clear')!.execute('', ctx)
    expect(messages).toHaveLength(1) // no-op, messages unchanged
  })

  it('/info shows system info', () => {
    const { ctx, messages } = makeContext(db)
    findCommand('info')!.execute('', ctx)
    expect(messages).toHaveLength(1)
    expect(messages[0].text).toContain('CueClaw')
    expect(messages[0].text).toContain('/tmp/test')
  })

  it('/daemon status shows status', () => {
    const { ctx, messages } = makeContext(db)
    findCommand('daemon')!.execute('status', ctx)
    expect(messages).toHaveLength(1)
    expect(messages[0].text).toContain('Daemon status')
  })

  it('commands show usage on missing args', () => {
    const { ctx, messages } = makeContext(db)
    findCommand('pause')!.execute('', ctx)
    expect(messages[0].text).toContain('Usage')

    messages.length = 0
    findCommand('resume')!.execute('', ctx)
    expect(messages[0].text).toContain('Usage')

    messages.length = 0
    findCommand('delete')!.execute('', ctx)
    expect(messages[0].text).toContain('Usage')
  })

  it('/theme shows current theme when no args', () => {
    const { ctx, messages } = makeContext(db)
    findCommand('theme')!.execute('', ctx)
    expect(messages).toHaveLength(1)
    expect(messages[0].text).toContain('Current theme')
    expect(messages[0].text).toContain('dark')
  })

  it('/theme switches to valid theme', () => {
    const { ctx, messages } = makeContext(db)
    findCommand('theme')!.execute('dracula', ctx)
    expect(messages).toHaveLength(1)
    expect(messages[0].text).toContain('Switched to dracula')
  })

  it('/theme errors on invalid theme', () => {
    const { ctx, messages } = makeContext(db)
    findCommand('theme')!.execute('nonexistent', ctx)
    expect(messages).toHaveLength(1)
    expect(messages[0].type).toBe('error')
    expect(messages[0].text).toContain('Unknown theme')
  })
})
