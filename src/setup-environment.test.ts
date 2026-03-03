import { describe, it, expect } from 'vitest'
import { checkEnvironment } from './setup-environment.js'

describe('setup/environment', () => {
  it('detects Node.js version', { timeout: 15_000 }, () => {
    const env = checkEnvironment()
    expect(env.nodeVersion).toMatch(/v?\d+\.\d+/)
    expect(parseInt(env.nodeVersion.replace(/^v/, ''))).toBeGreaterThanOrEqual(22)
  })

  it('returns docker status fields', { timeout: 15_000 }, () => {
    const env = checkEnvironment()
    // Docker may or may not be installed in test env, but the fields should exist
    expect(typeof env.docker).toBe('boolean')
    expect('dockerVersion' in env).toBe(true)
    expect('dockerRunning' in env).toBe(true)
  })
})
