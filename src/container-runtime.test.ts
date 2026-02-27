import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { isDockerAvailable, resetDockerCache } from './container-runtime.js'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

const mockExecFileSync = vi.mocked(execFileSync)

describe('isDockerAvailable', () => {
  beforeEach(() => {
    resetDockerCache()
    mockExecFileSync.mockReset()
  })

  afterEach(() => {
    resetDockerCache()
  })

  it('returns true when docker info succeeds', () => {
    mockExecFileSync.mockReturnValue('')
    expect(isDockerAvailable()).toBe(true)
    expect(mockExecFileSync).toHaveBeenCalledWith('docker', ['info'], { encoding: 'utf-8', stdio: 'pipe' })
  })

  it('returns false when docker info fails', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('not found') })
    expect(isDockerAvailable()).toBe(false)
  })

  it('caches the result', () => {
    mockExecFileSync.mockReturnValue('')
    isDockerAvailable()
    isDockerAvailable()
    expect(mockExecFileSync).toHaveBeenCalledTimes(1)
  })

  it('resetDockerCache clears the cache', () => {
    mockExecFileSync.mockReturnValue('')
    isDockerAvailable()
    resetDockerCache()
    mockExecFileSync.mockImplementation(() => { throw new Error('stopped') })
    expect(isDockerAvailable()).toBe(false)
    expect(mockExecFileSync).toHaveBeenCalledTimes(2)
  })
})
