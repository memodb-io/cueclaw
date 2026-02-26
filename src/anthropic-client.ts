import Anthropic from '@anthropic-ai/sdk'
import type { CueclawConfig } from './config.js'

const ANTHROPIC_OFFICIAL = 'https://api.anthropic.com'

/** Create an Anthropic SDK client with correct auth for official API vs third-party proxies (OpenRouter, etc.) */
export function createAnthropicClient(config: CueclawConfig): Anthropic {
  const isThirdParty = config.claude.base_url !== ANTHROPIC_OFFICIAL
  return new Anthropic({
    ...(isThirdParty
      ? { authToken: config.claude.api_key, apiKey: '' }
      : { apiKey: config.claude.api_key }),
    baseURL: config.claude.base_url,
  })
}
