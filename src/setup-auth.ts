import Anthropic from '@anthropic-ai/sdk'
import type { CueclawConfig } from './config.js'

export async function validateAuth(config: CueclawConfig): Promise<{ valid: boolean; error?: string }> {
  try {
    const client = new Anthropic({ apiKey: config.claude.api_key })
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
