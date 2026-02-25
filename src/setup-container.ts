import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export function buildContainer(projectRoot: string): { success: boolean; error?: string } {
  const buildScript = join(projectRoot, 'container', 'build.sh')

  try {
    execFileSync('bash', [buildScript], {
      encoding: 'utf-8',
      stdio: 'inherit',
      cwd: join(projectRoot, 'container'),
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function checkContainerImage(imageName: string): boolean {
  try {
    const result = execFileSync('docker', ['image', 'inspect', imageName], {
      encoding: 'utf-8',
      stdio: 'pipe',
    })
    return result.length > 0
  } catch {
    return false
  }
}
