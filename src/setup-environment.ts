import { execFileSync } from 'node:child_process'

export interface EnvironmentCheck {
  docker: boolean
  dockerVersion?: string
  dockerRunning: boolean
  nodeVersion: string
}

export function checkEnvironment(): EnvironmentCheck {
  const nodeVersion = process.version

  let docker = false
  let dockerVersion: string | undefined
  let dockerRunning = false

  try {
    const version = execFileSync('docker', ['--version'], { encoding: 'utf-8' }).trim()
    docker = true
    dockerVersion = version
  } catch {
    // Docker not installed
  }

  if (docker) {
    try {
      execFileSync('docker', ['info'], { encoding: 'utf-8', stdio: 'pipe' })
      dockerRunning = true
    } catch {
      // Docker not running
    }
  }

  return { docker, dockerVersion, dockerRunning, nodeVersion }
}
