import { describe, it, expect } from 'vitest'
import { expandHome, validateAdditionalMounts, generateDefaultAllowlist } from './mount-security.js'
import { homedir } from 'node:os'
import type { AdditionalMount, MountAllowlist } from './types.js'

describe('expandHome', () => {
  it('expands ~/path to homedir', () => {
    expect(expandHome('~/projects')).toBe(`${homedir()}/projects`)
  })

  it('expands bare ~ to homedir', () => {
    expect(expandHome('~')).toBe(homedir())
  })

  it('leaves absolute paths unchanged', () => {
    expect(expandHome('/tmp/foo')).toBe('/tmp/foo')
  })
})

describe('generateDefaultAllowlist', () => {
  it('includes ~/projects and /tmp as allowed roots', () => {
    const list = generateDefaultAllowlist()
    expect(list.allowedRoots).toHaveLength(2)
    expect(list.allowedRoots[0].path).toBe('~/projects')
    expect(list.allowedRoots[1].path).toBe('/tmp')
  })

  it('has blocked patterns for sensitive directories', () => {
    const list = generateDefaultAllowlist()
    expect(list.blockedPatterns).toContain('.ssh')
    expect(list.blockedPatterns).toContain('.gnupg')
    expect(list.blockedPatterns).toContain('.aws')
  })
})

describe('validateAdditionalMounts', () => {
  const allowlist: MountAllowlist = {
    allowedRoots: [
      { path: '/tmp', allowReadWrite: true, description: 'Temp' },
      { path: '~/projects', allowReadWrite: false, description: 'Projects' },
    ],
    blockedPatterns: ['.ssh', '.env', 'credentials'],
    nonMainReadOnly: true,
  }

  it('allows valid mounts within allowed roots', () => {
    const mounts: AdditionalMount[] = [
      { hostPath: '/tmp/data', readonly: true },
    ]
    expect(() => validateAdditionalMounts(mounts, allowlist)).not.toThrow()
  })

  it('rejects mounts outside allowed roots', () => {
    const mounts: AdditionalMount[] = [
      { hostPath: '/etc/passwd', readonly: true },
    ]
    expect(() => validateAdditionalMounts(mounts, allowlist)).toThrow('Mount not in allowlist')
  })

  it('rejects mounts matching blocked patterns', () => {
    const mounts: AdditionalMount[] = [
      { hostPath: '/tmp/.ssh/keys', readonly: true },
    ]
    expect(() => validateAdditionalMounts(mounts, allowlist)).toThrow('blocked pattern')
  })

  it('rejects read-write mounts when not allowed', () => {
    const mounts: AdditionalMount[] = [
      { hostPath: `${homedir()}/projects/foo`, readonly: false },
    ]
    expect(() => validateAdditionalMounts(mounts, allowlist)).toThrow('read-only in allowlist')
  })

  it('allows read-write when root permits it', () => {
    const mounts: AdditionalMount[] = [
      { hostPath: '/tmp/workdir', readonly: false },
    ]
    expect(() => validateAdditionalMounts(mounts, allowlist)).not.toThrow()
  })
})
