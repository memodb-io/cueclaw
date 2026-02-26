import type { CueclawConfig } from './config.js'
import { createAnthropicClient } from './anthropic-client.js'

export async function validateAuth(config: CueclawConfig): Promise<{ valid: boolean; error?: string }> {
  try {
    const client = createAnthropicClient(config)
    await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'ping' }],
    })
    return { valid: true }
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) }
  }
}
