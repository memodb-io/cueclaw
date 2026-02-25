import { describe, it, expect, vi, beforeEach } from 'vitest'
import { _initTestDatabase } from './db.js'
import { McpMessageHandler, type MessageRouter } from './mcp-server.js'
import type { IpcWatcher, IpcMessage } from './ipc.js'

describe('McpMessageHandler', () => {
  let db: ReturnType<typeof _initTestDatabase>
  let router: MessageRouter
  let sentMessages: IpcMessage[]
  let mockWatcher: IpcWatcher

  beforeEach(() => {
    db = _initTestDatabase()
    router = { broadcastNotification: vi.fn() }
    sentMessages = []
    mockWatcher = {
      sendToContainer: (msg: IpcMessage) => sentMessages.push(msg),
    } as unknown as IpcWatcher
  })

  it('handles progress messages by updating step_runs', () => {
    // Insert prerequisite data
    db.prepare('INSERT INTO workflows (id, name, description, steps_json, trigger_json, failure_policy_json, phase, schema_version, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('wf1', 'Test', 'desc', '[]', '{}', '{}', 'executing', 1, '{}', new Date().toISOString(), new Date().toISOString())
    db.prepare('INSERT INTO workflow_runs (id, workflow_id, status, started_at) VALUES (?, ?, ?, ?)')
      .run('run1', 'wf1', 'running', new Date().toISOString())
    db.prepare('INSERT INTO step_runs (id, run_id, step_id, status) VALUES (?, ?, ?, ?)')
      .run('sr1', 'run1', 'step1', 'running')

    const handler = new McpMessageHandler(db, router, mockWatcher)
    handler.handle({
      workflowId: 'wf1',
      stepId: 'step1',
      type: 'progress',
      data: { status: 'succeeded', output: 'done', runId: 'run1' },
      timestamp: new Date().toISOString(),
    })

    const row = db.prepare('SELECT status, output_json FROM step_runs WHERE step_id = ?').get('step1') as any
    expect(row.status).toBe('succeeded')
    expect(row.output_json).toBe('done')
  })

  it('handles notification messages by broadcasting', () => {
    const handler = new McpMessageHandler(db, router, mockWatcher)
    handler.handle({
      workflowId: 'wf1',
      stepId: 'step1',
      type: 'notification',
      data: { message: 'Hello world' },
      timestamp: new Date().toISOString(),
    })

    expect(router.broadcastNotification).toHaveBeenCalledWith('Hello world')
  })

  it('handles context requests by sending step output back', () => {
    db.prepare('INSERT INTO workflows (id, name, description, steps_json, trigger_json, failure_policy_json, phase, schema_version, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('wf1', 'Test', 'desc', '[]', '{}', '{}', 'executing', 1, '{}', new Date().toISOString(), new Date().toISOString())
    db.prepare('INSERT INTO workflow_runs (id, workflow_id, status, started_at) VALUES (?, ?, ?, ?)')
      .run('run1', 'wf1', 'running', new Date().toISOString())
    db.prepare('INSERT INTO step_runs (id, run_id, step_id, status, output_json) VALUES (?, ?, ?, ?, ?)')
      .run('sr1', 'run1', 'prev_step', 'succeeded', '{"result":"data"}')

    const handler = new McpMessageHandler(db, router, mockWatcher)
    handler.handle({
      workflowId: 'wf1',
      stepId: 'step1',
      type: 'context_request',
      correlationId: 'corr-123',
      data: { requestedStepId: 'prev_step', runId: 'run1' },
      timestamp: new Date().toISOString(),
    })

    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0].correlationId).toBe('corr-123')
    expect(sentMessages[0].data.context).toBe('{"result":"data"}')
  })

  it('handles context request for non-existent step', () => {
    const handler = new McpMessageHandler(db, router, mockWatcher)
    handler.handle({
      workflowId: 'wf1',
      stepId: 'step1',
      type: 'context_request',
      correlationId: 'corr-456',
      data: { requestedStepId: 'missing', runId: 'run1' },
      timestamp: new Date().toISOString(),
    })

    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0].data.context).toBeNull()
  })
})
