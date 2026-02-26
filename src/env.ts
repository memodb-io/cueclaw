import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'dotenv'

let secrets: Record<string, string> = {}

/** True when running via tsx (dev mode) rather than compiled dist */
export const isDev = !import.meta.url.includes('/dist/')

export function loadSecrets(): void {
  if (!isDev) return // production relies on real env vars / config.yaml

  // Resolve .env relative to project root (parent of src/)
  const thisDir = dirname(fileURLToPath(import.meta.url))
  const envPath = resolve(thisDir, '..', '.env')

  if (!existsSync(envPath)) return
  const content = readFileSync(envPath, 'utf-8')
  secrets = parse(content)
  // Inject into process.env (don't overwrite existing values)
  for (const [key, value] of Object.entries(secrets)) {
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

export function getSecret(key: string): string | undefined {
  return secrets[key] ?? process.env[key]
}

export function hasSecret(key: string): boolean {
  return getSecret(key) !== undefined
}

/**
 * Write or update a key in the project .env file (dev mode only).
 * Appends if the key doesn't exist, replaces the line if it does.
 */
/**
 * Scan process.env for keys matching common credential patterns.
 * Returns only key names (never values).
 */
export function getConfiguredSecretKeys(): string[] {
  const patterns = [/_TOKEN$/, /_API_KEY$/, /_SECRET$/, /_WEBHOOK/, /_PASSWORD$/]
  return Object.keys(process.env)
    .filter(k => patterns.some(p => p.test(k)) && process.env[k])
    .sort()
}

export function writeEnvVar(key: string, value: string): void {
  if (!isDev) throw new Error('writeEnvVar should only be called in dev mode')
  const thisDir = dirname(fileURLToPath(import.meta.url))
  const envPath = resolve(thisDir, '..', '.env')

  let lines: string[] = []
  if (existsSync(envPath)) {
    lines = readFileSync(envPath, 'utf-8').split('\n')
  }

  const idx = lines.findIndex(l => l.startsWith(`${key}=`))
  const entry = `${key}=${value}`
  if (idx >= 0) {
    lines[idx] = entry
  } else {
    lines.push(entry)
  }

  // Remove trailing empty lines, ensure final newline
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8')

  // Also update in-memory
  process.env[key] = value
  secrets[key] = value
}
