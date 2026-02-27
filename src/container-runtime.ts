import { execFileSync } from 'node:child_process'

let cached: boolean | undefined

/** Check if Docker CLI is installed and daemon is running. Result is cached for the process lifetime. */
export function isDockerAvailable(): boolean {
  if (cached !== undefined) return cached

  try {
    execFileSync('docker', ['info'], { encoding: 'utf-8', stdio: 'pipe' })
    cached = true
  } catch {
    cached = false
  }

  return cached
}

/** Reset the cached result (for testing). */
export function resetDockerCache(): void {
  cached = undefined
}
