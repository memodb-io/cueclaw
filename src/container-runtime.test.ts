import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isDockerAvailable, ensureDockerImage, resetDockerCache } from './container-runtime.js'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: vi.fn(() => true) }
})

vi.mock('./env.js', () => ({ isDev: false }))

const mockExecFileSync = vi.mocked(execFileSync)
const mockExistsSync = vi.mocked(existsSync)

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

describe('ensureDockerImage (production)', () => {
  beforeEach(() => {
    resetDockerCache()
    mockExecFileSync.mockReset()
  })

  afterEach(() => {
    resetDockerCache()
  })

  it('returns true when image exists locally', () => {
    mockExecFileSync.mockReturnValue('')
    expect(ensureDockerImage('ghcr.io/memodb-io/cueclaw-agent:0.1.2')).toBe(true)
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'docker', ['image', 'inspect', 'ghcr.io/memodb-io/cueclaw-agent:0.1.2'],
      { encoding: 'utf-8', stdio: 'pipe' },
    )
    // Should not attempt pull
    expect(mockExecFileSync).not.toHaveBeenCalledWith(
      'docker', ['pull', expect.any(String)], expect.any(Object),
    )
  })

  it('pulls image when not found locally and succeeds', () => {
    mockExecFileSync
      .mockImplementationOnce(() => { throw new Error('No such image') })
      .mockReturnValueOnce('')
    expect(ensureDockerImage('ghcr.io/memodb-io/cueclaw-agent:0.1.2')).toBe(true)
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'docker', ['pull', 'ghcr.io/memodb-io/cueclaw-agent:0.1.2'],
      expect.objectContaining({ encoding: 'utf-8', timeout: 300_000 }),
    )
  })

  it('returns false when pull also fails', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('failed') })
    expect(ensureDockerImage('ghcr.io/memodb-io/cueclaw-agent:0.1.2')).toBe(false)
  })

  it('caches successful pull result', () => {
    mockExecFileSync
      .mockImplementationOnce(() => { throw new Error('No such image') })
      .mockReturnValueOnce('')
    ensureDockerImage('ghcr.io/memodb-io/cueclaw-agent:0.1.2')
    mockExecFileSync.mockReset()
    expect(ensureDockerImage('ghcr.io/memodb-io/cueclaw-agent:0.1.2')).toBe(true)
    expect(mockExecFileSync).not.toHaveBeenCalled()
  })
})

describe('ensureDockerImage (dev mode)', () => {
  beforeEach(async () => {
    resetDockerCache()
    mockExecFileSync.mockReset()
    mockExistsSync.mockReturnValue(true)
    // Switch isDev to true for this suite
    const env = await import('./env.js')
    ;(env as any).isDev = true
  })

  afterEach(async () => {
    resetDockerCache()
    const env = await import('./env.js')
    ;(env as any).isDev = false
  })

  it('auto-builds image via build.sh when not found locally', () => {
    // docker image inspect fails, then build.sh succeeds
    mockExecFileSync
      .mockImplementationOnce(() => { throw new Error('No such image') })
      .mockReturnValueOnce('')
    expect(ensureDockerImage('cueclaw-agent:latest')).toBe(true)
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'bash', [expect.stringContaining('container/build.sh')],
      expect.objectContaining({ stdio: 'inherit' }),
    )
  })

  it('returns false when build.sh not found', () => {
    mockExecFileSync.mockImplementationOnce(() => { throw new Error('No such image') })
    mockExistsSync.mockReturnValue(false)
    expect(ensureDockerImage('cueclaw-agent:latest')).toBe(false)
  })

  it('returns false when build fails', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('build error') })
    expect(ensureDockerImage('cueclaw-agent:latest')).toBe(false)
  })
})
