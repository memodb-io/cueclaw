import { writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { cueclawHome } from './config.js'
import { logger } from './logger.js'

const SERVICE_LABEL = 'com.cueclaw'

/**
 * Install CueClaw as a system service.
 * macOS: launchd plist
 * Linux: systemd user service
 */
export function installService(): { success: boolean; error?: string } {
  const platform = process.platform
  try {
    if (platform === 'darwin') {
      return installLaunchd()
    } else if (platform === 'linux') {
      return installSystemd()
    } else {
      return { success: false, error: `Unsupported platform: ${platform}` }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function uninstallService(): { success: boolean; error?: string } {
  const platform = process.platform
  try {
    if (platform === 'darwin') {
      return uninstallLaunchd()
    } else if (platform === 'linux') {
      return uninstallSystemd()
    } else {
      return { success: false, error: `Unsupported platform: ${platform}` }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function stopService(): { success: boolean; error?: string } {
  const platform = process.platform
  try {
    if (platform === 'darwin') {
      execFileSync('launchctl', ['stop', SERVICE_LABEL], { stdio: 'pipe' })
      return { success: true }
    } else if (platform === 'linux') {
      execFileSync('systemctl', ['--user', 'stop', 'cueclaw'], { stdio: 'pipe' })
      return { success: true }
    } else {
      return { success: false, error: `Unsupported platform: ${platform}` }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function getServiceStatus(): 'running' | 'stopped' | 'unknown' {
  const platform = process.platform
  try {
    if (platform === 'darwin') {
      const output = execFileSync('launchctl', ['list', SERVICE_LABEL], { encoding: 'utf-8', stdio: 'pipe' })
      return output.includes('"PID"') ? 'running' : 'stopped'
    } else if (platform === 'linux') {
      const output = execFileSync('systemctl', ['--user', 'is-active', 'cueclaw'], { encoding: 'utf-8', stdio: 'pipe' }).trim()
      return output === 'active' ? 'running' : 'stopped'
    }
  } catch {
    return 'stopped'
  }
  return 'unknown'
}

// ─── macOS launchd ───

function installLaunchd(): { success: boolean; error?: string } {
  const home = process.env['HOME']
  if (!home) return { success: false, error: 'HOME not set' }

  const plistDir = join(home, 'Library', 'LaunchAgents')
  mkdirSync(plistDir, { recursive: true })
  const plistPath = join(plistDir, `${SERVICE_LABEL}.plist`)

  const logDir = join(cueclawHome(), 'logs')
  mkdirSync(logDir, { recursive: true })

  const nodePath = process.execPath
  const cliPath = join(process.cwd(), 'dist', 'cli.js')

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${cliPath}</string>
    <string>daemon</string>
    <string>start</string>
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${join(logDir, 'daemon.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(logDir, 'daemon.log')}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>`

  writeFileSync(plistPath, plist)
  execFileSync('launchctl', ['load', plistPath])
  logger.info({ plistPath }, 'Installed launchd service')
  return { success: true }
}

function uninstallLaunchd(): { success: boolean; error?: string } {
  const home = process.env['HOME']
  if (!home) return { success: false, error: 'HOME not set' }

  const plistPath = join(home, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`)
  if (!existsSync(plistPath)) return { success: false, error: 'Service not installed' }

  try { execFileSync('launchctl', ['unload', plistPath]) } catch { /* may not be loaded */ }
  unlinkSync(plistPath)
  logger.info('Uninstalled launchd service')
  return { success: true }
}

// ─── Linux systemd ───

function installSystemd(): { success: boolean; error?: string } {
  const home = process.env['HOME']
  if (!home) return { success: false, error: 'HOME not set' }

  const serviceDir = join(home, '.config', 'systemd', 'user')
  mkdirSync(serviceDir, { recursive: true })
  const servicePath = join(serviceDir, 'cueclaw.service')

  const nodePath = process.execPath
  const cliPath = join(process.cwd(), 'dist', 'cli.js')

  const service = `[Unit]
Description=CueClaw Daemon
After=network.target

[Service]
ExecStart=${nodePath} ${cliPath} daemon start
Restart=always
RestartSec=5

[Install]
WantedBy=default.target`

  writeFileSync(servicePath, service)
  execFileSync('systemctl', ['--user', 'daemon-reload'])
  execFileSync('systemctl', ['--user', 'enable', '--now', 'cueclaw'])
  logger.info({ servicePath }, 'Installed systemd service')
  return { success: true }
}

function uninstallSystemd(): { success: boolean; error?: string } {
  const home = process.env['HOME']
  if (!home) return { success: false, error: 'HOME not set' }

  const servicePath = join(home, '.config', 'systemd', 'user', 'cueclaw.service')
  if (!existsSync(servicePath)) return { success: false, error: 'Service not installed' }

  try { execFileSync('systemctl', ['--user', 'disable', '--now', 'cueclaw']) } catch { /* ok */ }
  unlinkSync(servicePath)
  execFileSync('systemctl', ['--user', 'daemon-reload'])
  logger.info('Uninstalled systemd service')
  return { success: true }
}
