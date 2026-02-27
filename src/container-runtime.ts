import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { logger } from './logger.js'
import { isDev } from './env.js'

let cached: boolean | undefined
let imageCache = new Map<string, boolean>()

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

/** Check if a Docker image exists locally. Result is cached for the process lifetime. */
export function isDockerImageAvailable(image: string): boolean {
  const hit = imageCache.get(image)
  if (hit !== undefined) return hit

  try {
    execFileSync('docker', ['image', 'inspect', image], { encoding: 'utf-8', stdio: 'pipe' })
    imageCache.set(image, true)
    return true
  } catch {
    imageCache.set(image, false)
    return false
  }
}

/**
 * Ensure a Docker image is available locally. Checks local cache first, then:
 * - Dev mode: runs `container/build.sh` to build the image from source
 * - Production: attempts `docker pull` from GHCR
 * Returns true if image is available. Result is cached per image.
 */
export function ensureDockerImage(image: string): boolean {
  if (isDockerImageAvailable(image)) return true

  if (isDev) {
    return buildDevImage(image)
  }

  // Production — attempt pull from registry
  logger.info({ image }, 'Docker image not found locally, attempting pull')
  try {
    execFileSync('docker', ['pull', image], { encoding: 'utf-8', stdio: 'pipe', timeout: 300_000 })
    imageCache.set(image, true)
    logger.info({ image }, 'Docker image pulled successfully')
    return true
  } catch (err) {
    logger.warn({ image, err }, 'Failed to pull Docker image')
    return false
  }
}

/** Dev mode: auto-build image via container/build.sh */
function buildDevImage(image: string): boolean {
  const thisDir = dirname(fileURLToPath(import.meta.url))
  const projectRoot = resolve(thisDir, '..')
  const buildScript = resolve(projectRoot, 'container', 'build.sh')

  if (!existsSync(buildScript)) {
    logger.warn({ buildScript }, 'container/build.sh not found, cannot auto-build')
    return false
  }

  logger.info({ image }, 'Dev mode: auto-building container image via container/build.sh')
  try {
    execFileSync('bash', [buildScript], {
      encoding: 'utf-8',
      stdio: 'inherit',
      cwd: resolve(projectRoot, 'container'),
    })
    imageCache.set(image, true)
    logger.info({ image }, 'Dev mode: container image built successfully')
    return true
  } catch (err) {
    logger.warn({ image, err }, 'Dev mode: container image build failed')
    return false
  }
}

/** Reset the cached result (for testing). */
export function resetDockerCache(): void {
  cached = undefined
  imageCache = new Map()
}
