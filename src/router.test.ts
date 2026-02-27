import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { _initTestDatabase } from './db.js'
import { MessageRouter } from './router.js'
import type { Channel } from './types.js'
import type { CueclawConfig } from './config.js'

vi.mock('./anthropic-client.js', () => ({
  createAnthropicClient: vi.fn(),
}))

function createMockChannel(name: string): Channel & { sentMessages: Array<{ jid: string; text: string }> } {
  const sentMessages: Array<{ jid: string; text: string }> = []
  return {
    name,
    sentMessages,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    sendMessage: vi.fn(async (jid: string, text: string) => {
      sentMessages.push({ jid, text })
      return `msg_${sentMessages.length}`
    }),
    sendConfirmation: vi.fn(async () => {}),
    isConnected: () => true,
    ownsJid: () => true,
  }
}

function createMockConfig(): CueclawConfig {
  return {
    claude: {
      api_key: 'test-key',
      base_url: 'https://api.anthropic.com',
      planner: { model: 'claude-sonnet-4-6' },
      executor: { model: 'claude-sonnet-4-6' },
    },
  } as CueclawConfig
}

describe('MessageRouter', () => {
  let db: ReturnType<typeof _initTestDatabase>
  let router: MessageRouter
  let channel: ReturnType<typeof createMockChannel>

  beforeEach(() => {
    db = _initTestDatabase()
    router = new MessageRouter(db, createMockConfig(), '/tmp')
    channel = createMockChannel('test')
    router.registerChannel(channel)
  })

  it('handles /help command', async () => {
    await router.handleInbound('test', 'user1', { text: '/help', sender: 'user1' })
    expect(channel.sentMessages).toHaveLength(1)
    expect(channel.sentMessages[0]!.text).toContain('Commands:')
  })

  it('handles /list command with no workflows', async () => {
    await router.handleInbound('test', 'user1', { text: '/list', sender: 'user1' })
    expect(channel.sentMessages).toHaveLength(1)
    expect(channel.sentMessages[0]!.text).toBe('No workflows found.')
  })

  it('handles unknown command', async () => {
    await router.handleInbound('test', 'user1', { text: '/unknown', sender: 'user1' })
    expect(channel.sentMessages).toHaveLength(1)
    expect(channel.sentMessages[0]!.text).toContain('Unknown command')
  })

  it('handles ! prefix commands (WhatsApp style)', async () => {
    await router.handleInbound('test', 'user1', { text: '!help', sender: 'user1' })
    expect(channel.sentMessages).toHaveLength(1)
    expect(channel.sentMessages[0]!.text).toContain('Commands:')
  })

  it('rate limits excessive messages', async () => {
    // Send 11 messages (limit is 10)
    for (let i = 0; i < 11; i++) {
      await router.handleInbound('test', 'user1', { text: `/help`, sender: 'user1' })
    }
    // The 11th should be rate limited
    const lastMsg = channel.sentMessages[channel.sentMessages.length - 1]!
    expect(lastMsg.text).toContain('Rate limited')
  })

  it('ignores messages from unknown channels', async () => {
    await router.handleInbound('nonexistent', 'user1', { text: '/help', sender: 'user1' })
    expect(channel.sentMessages).toHaveLength(0)
  })

  it('cleans up rate limit state', () => {
    router.start()
    // Just verify start/stop doesn't throw
    router.stop()
  })

  describe('classifyAndRoute', () => {
    it('routes casual chat to chat_reply instead of workflow generation', async () => {
      const { createAnthropicClient } = await import('./anthropic-client.js')
      const mockCreate = vi.fn().mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'chat_reply',
            input: { message: 'Hello! I can help you automate tasks.' },
          },
        ],
      })
      ;(createAnthropicClient as Mock).mockReturnValue({ messages: { create: mockCreate } })

      await router.handleInbound('test', 'user1', 'hello')
      expect(channel.sentMessages).toHaveLength(1)
      expect(channel.sentMessages[0]!.text).toBe('Hello! I can help you automate tasks.')
    })

    it('routes workflow requests to plan generation', async () => {
      const { createAnthropicClient } = await import('./anthropic-client.js')
      const mockCreate = vi.fn().mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'create_workflow_request',
            input: {},
          },
        ],
      })
      ;(createAnthropicClient as Mock).mockReturnValue({ messages: { create: mockCreate } })

      // This will try to call generatePlan which will fail, but we can verify it got past classification
      await router.handleInbound('test', 'user1', 'monitor my website every 5 minutes')
      // Should see "Generating execution plan..." followed by a failure (since generatePlan isn't mocked)
      expect(channel.sentMessages[0]!.text).toBe('Generating execution plan...')
    })

    it('falls back to workflow on classification error', async () => {
      const { createAnthropicClient } = await import('./anthropic-client.js')
      const mockCreate = vi.fn().mockRejectedValue(new Error('API error'))
      ;(createAnthropicClient as Mock).mockReturnValue({ messages: { create: mockCreate } })

      await router.handleInbound('test', 'user1', 'do something')
      expect(channel.sentMessages[0]!.text).toBe('Generating execution plan...')
    })
  })

  describe('confirmation timeout', () => {
    it('notifies user when pending confirmation has expired', async () => {
      const { createAnthropicClient } = await import('./anthropic-client.js')
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'create_workflow_request', input: {} }],
      })
      ;(createAnthropicClient as Mock).mockReturnValue({ messages: { create: mockCreate } })

      // Manually set an expired pending confirmation
      const { insertWorkflow } = await import('./db.js')
      const workflow = {
        id: 'wf_test',
        name: 'Test',
        description: 'test',
        trigger: { type: 'manual' as const },
        steps: [],
        failure_policy: { on_step_failure: 'stop' as const, max_retries: 0, retry_delay_ms: 5000 },
        phase: 'awaiting_confirmation' as const,
        schema_version: '1.0' as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      insertWorkflow(db, workflow)

      // Access private pendingConfirmations via any cast
      const routerAny = router as any
      routerAny.pendingConfirmations.set('user1', {
        workflowId: 'wf_test',
        workflow,
        channelContext: { channel: 'test', chatJid: 'user1', sender: 'user1' },
        expiresAt: Date.now() - 1000, // Already expired
      })

      await router.handleInbound('test', 'user1', { text: 'yes', sender: 'user1' })
      expect(channel.sentMessages[0]!.text).toContain('expired')
    })
  })

  describe('disconnectAll', () => {
    it('disconnects all registered channels', async () => {
      const channel2 = createMockChannel('test2')
      router.registerChannel(channel2)

      await router.disconnectAll()
      expect(channel.disconnect).toHaveBeenCalledOnce()
      expect(channel2.disconnect).toHaveBeenCalledOnce()
    })
  })

  describe('handleCallbackAction', () => {
    it('maps confirm action to yes and handles confirmation', async () => {
      // Set up a pending confirmation first
      const { createAnthropicClient } = await import('./anthropic-client.js')
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'create_workflow_request', input: {} }],
      })
      ;(createAnthropicClient as Mock).mockReturnValue({ messages: { create: mockCreate } })

      // Spy on handleInbound to verify it's called with mapped text
      const spy = vi.spyOn(router, 'handleInbound')
      await router.handleCallbackAction('test', 'user1', 'wf-123', 'confirm')
      expect(spy).toHaveBeenCalledWith('test', 'user1', { text: 'yes', sender: 'user1' })
    })

    it('maps cancel action to no', async () => {
      const spy = vi.spyOn(router, 'handleInbound')
      await router.handleCallbackAction('test', 'user1', 'wf-123', 'cancel')
      expect(spy).toHaveBeenCalledWith('test', 'user1', { text: 'no', sender: 'user1' })
    })

    it('maps modify action to modify', async () => {
      const spy = vi.spyOn(router, 'handleInbound')
      await router.handleCallbackAction('test', 'user1', 'wf-123', 'modify')
      expect(spy).toHaveBeenCalledWith('test', 'user1', { text: 'modify', sender: 'user1' })
    })
  })
})
