import { describe, it, expect, vi, beforeEach } from 'vitest'
import { _initTestDatabase } from './db.js'
import { MessageRouter } from './router.js'
import type { Channel } from './types.js'
import type { CueclawConfig } from './config.js'

function createMockChannel(name: string): Channel & { sentMessages: Array<{ jid: string; text: string }> } {
  const sentMessages: Array<{ jid: string; text: string }> = []
  return {
    name,
    sentMessages,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    sendMessage: vi.fn(async (jid: string, text: string) => {
      sentMessages.push({ jid, text })
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
})
