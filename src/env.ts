import { readFileSync, existsSync } from 'node:fs'
import { parse } from 'dotenv'

let secrets: Record<string, string> = {}

export function loadSecrets(envPath = '.env'): void {
  if (!existsSync(envPath)) return
  const content = readFileSync(envPath, 'utf-8')
  secrets = parse(content)
}

export function getSecret(key: string): string | undefined {
  return secrets[key] ?? process.env[key]
}

export function hasSecret(key: string): boolean {
  return getSecret(key) !== undefined
}
