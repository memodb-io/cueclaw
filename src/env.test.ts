import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getSecret, hasSecret, loadSecrets, getConfiguredSecretKeys } from './env.js'

describe('Environment & Secrets', () => {
  beforeEach(() => {
    // loadSecrets in dev mode loads project .env; safe as a no-op if .env is missing
    loadSecrets()
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

describe('getConfiguredSecretKeys', () => {
  const testKeys = ['MY_TEST_TOKEN', 'SLACK_API_KEY', 'DB_SECRET', 'NOTIFY_WEBHOOK_URL', 'SMTP_PASSWORD']

  beforeEach(() => {
    for (const k of testKeys) {
      process.env[k] = 'dummy'
    }
  })

  afterEach(() => {
    for (const k of testKeys) {
      delete process.env[k]
    }
  })

  it('returns keys matching credential patterns', () => {
    const keys = getConfiguredSecretKeys()
    expect(keys).toContain('MY_TEST_TOKEN')
    expect(keys).toContain('SLACK_API_KEY')
    expect(keys).toContain('DB_SECRET')
    expect(keys).toContain('NOTIFY_WEBHOOK_URL')
    expect(keys).toContain('SMTP_PASSWORD')
  })

  it('returns keys in sorted order', () => {
    const keys = getConfiguredSecretKeys()
    const filtered = keys.filter(k => testKeys.includes(k))
    expect(filtered).toEqual([...filtered].sort())
  })

  it('excludes keys with empty values', () => {
    process.env['EMPTY_TOKEN'] = ''
    const keys = getConfiguredSecretKeys()
    expect(keys).not.toContain('EMPTY_TOKEN')
    delete process.env['EMPTY_TOKEN']
  })

  it('excludes keys not matching patterns', () => {
    process.env['REGULAR_VAR'] = 'value'
    const keys = getConfiguredSecretKeys()
    expect(keys).not.toContain('REGULAR_VAR')
    delete process.env['REGULAR_VAR']
  })
})
