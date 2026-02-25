import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { cueclawHome } from './config.js'
import { ConfigError } from './types.js'
import type { AdditionalMount, MountAllowlist } from './types.js'

export function expandHome(path: string): string {
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  if (path === '~') return homedir()
  return path
}

export function loadMountAllowlist(): MountAllowlist {
  const path = join(cueclawHome(), 'mount-allowlist.json')
  if (!existsSync(path)) {
    const defaults = generateDefaultAllowlist()
    writeFileSync(path, JSON.stringify(defaults, null, 2))
    return defaults
  }
  return JSON.parse(readFileSync(path, 'utf-8'))
}

export function validateAdditionalMounts(
  mounts: AdditionalMount[],
  allowlist: MountAllowlist,
): void {
  for (const mount of mounts) {
    const expanded = expandHome(mount.hostPath)

    // Check blocked patterns
    for (const pattern of allowlist.blockedPatterns) {
      if (expanded.includes(pattern)) {
        throw new ConfigError(`Mount blocked: "${mount.hostPath}" matches blocked pattern "${pattern}"`)
      }
    }

    // Check against allowed roots
    const allowed = allowlist.allowedRoots.find(root =>
      expanded.startsWith(expandHome(root.path))
    )
    if (!allowed) {
      throw new ConfigError(`Mount not in allowlist: "${mount.hostPath}". Add it to ~/.cueclaw/mount-allowlist.json`)
    }

    // Check read-write permission
    if (mount.readonly === false && !allowed.allowReadWrite) {
      throw new ConfigError(`Mount "${mount.hostPath}" is read-only in allowlist but requested read-write`)
    }
  }
}

export function generateDefaultAllowlist(): MountAllowlist {
  return {
    allowedRoots: [
      { path: '~/projects', allowReadWrite: true, description: 'User project directories' },
      { path: '/tmp', allowReadWrite: true, description: 'Temporary files' },
    ],
    blockedPatterns: ['.ssh', '.gnupg', '.aws', '.env', 'credentials', 'private_key', '.docker'],
    nonMainReadOnly: true,
  }
}
