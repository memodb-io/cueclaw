import { describe, it, expect, beforeEach } from 'vitest'
import { getSecret, hasSecret, loadSecrets } from './env.js'

describe('Environment & Secrets', () => {
  beforeEach(() => {
    // loadSecrets with a non-existent file is a no-op
    loadSecrets('/tmp/nonexistent.env')
  })

  it('getSecret falls back to process.env', () => {
    process.env['TEST_SECRET_KEY'] = 'test-value'
    expect(getSecret('TEST_SECRET_KEY')).toBe('test-value')
    delete process.env['TEST_SECRET_KEY']
  })

  it('hasSecret returns false for missing keys', () => {
    expect(hasSecret('DEFINITELY_DOES_NOT_EXIST_12345')).toBe(false)
  })

  it('getSecret returns undefined for missing keys', () => {
    expect(getSecret('DEFINITELY_DOES_NOT_EXIST_12345')).toBeUndefined()
  })
})
