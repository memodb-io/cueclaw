import { describe, it, expect } from 'vitest'
import { escapeMdV2, chunkMessage } from './telegram.js'

describe('Telegram helpers', () => {
  describe('escapeMdV2', () => {
    it('escapes special characters', () => {
      expect(escapeMdV2('hello_world')).toBe('hello\\_world')
      expect(escapeMdV2('*bold*')).toBe('\\*bold\\*')
      expect(escapeMdV2('test.end')).toBe('test\\.end')
    })

    it('handles text with no special characters', () => {
      expect(escapeMdV2('hello world')).toBe('hello world')
    })
  })

  describe('chunkMessage', () => {
    it('returns single chunk for short messages', () => {
      const chunks = chunkMessage('Hello world')
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toBe('Hello world')
    })

    it('splits long messages at newlines', () => {
      const lines = Array.from({ length: 200 }, (_, i) => `Line ${i}: ${'x'.repeat(30)}`)
      const text = lines.join('\n')
      const chunks = chunkMessage(text)
      expect(chunks.length).toBeGreaterThan(1)
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(4096)
      }
    })
  })
})
