import { execFileSync } from 'node:child_process'

export function runSmokeTest(imageName: string): { success: boolean; error?: string } {
  try {
    // Simple verification: start container and check it can execute
    const result = execFileSync('docker', [
      'run', '--rm',
      '--network', 'none',
      '--user', '1000:1000',
      imageName,
      'node', '-e', 'console.log("cueclaw-smoke-ok")',
    ], {
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: 'pipe',
    })

    if (result.includes('cueclaw-smoke-ok')) {
      return { success: true }
    }
    return { success: false, error: 'Smoke test output mismatch' }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
