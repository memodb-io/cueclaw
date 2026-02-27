import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { z } from 'zod/v4'
import { ConfigError } from './types.js'

// ─── Zod Schema ───

const ConfigSchema = z.object({
  claude: z.object({
    api_key: z.string(),
    base_url: z.url().default('https://api.anthropic.com'),
    planner: z.object({ model: z.string().default('claude-sonnet-4-6') }).default({ model: 'claude-sonnet-4-6' }),
    executor: z.object({
      model: z.string().default('claude-sonnet-4-6'),
      api_key: z.string().optional(),
      base_url: z.url().optional(),
      skip_permissions: z.boolean().default(false),
    }).default({ model: 'claude-sonnet-4-6', skip_permissions: false }),
  }),
  identity: z.object({ name: z.string() }).optional(),
  whatsapp: z.object({
    enabled: z.boolean().default(false),
    auth_dir: z.string().default('~/.cueclaw/auth/whatsapp'),
    allowed_jids: z.array(z.string()).default([]),
  }).optional(),
  telegram: z.object({
    enabled: z.boolean().default(false),
    token: z.string().optional(),
    allowed_users: z.array(z.string()).default([]),
  }).optional(),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    dir: z.string().default('~/.cueclaw/logs'),
  }).optional(),
  container: z.object({
    enabled: z.boolean().default(true),
    image: z.string().default('cueclaw-agent:latest'),
    timeout: z.number().default(1_800_000),
    max_output_size: z.number().default(10_485_760),
    idle_timeout: z.number().default(1_800_000),
    network: z.enum(['none', 'host', 'bridge']).default('none'),
  }).optional(),
})

export type CueclawConfig = z.infer<typeof ConfigSchema>

// ─── Paths ───

export function cueclawHome(): string {
  return join(homedir(), '.cueclaw')
}

export function ensureCueclawHome(): void {
  const home = cueclawHome()
  const dirs = [home, join(home, 'db'), join(home, 'logs'), join(home, 'auth')]
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true })
  }
}

// ─── Env Var Interpolation ───

function interpolateEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_match, name: string) => {
    return process.env[name] ?? ''
  })
}

function interpolateObject(obj: any): any {
  if (typeof obj === 'string') return interpolateEnvVars(obj)
  if (Array.isArray(obj)) return obj.map(interpolateObject)
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, any> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateObject(value)
    }
    return result
  }
  return obj
}

// ─── Config Loading ───

function loadYamlFile(path: string): Record<string, any> | null {
  if (!existsSync(path)) return null
  const content = readFileSync(path, 'utf-8')
  const parsed = parseYaml(content)
  return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : null
}

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target }
  for (const [key, value] of Object.entries(source)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value) &&
        result[key] !== null && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key] as Record<string, any>, value as Record<string, any>)
    } else {
      result[key] = value
    }
  }
  return result
}

export function loadConfig(): CueclawConfig {
  const globalPath = join(cueclawHome(), 'config.yaml')
  const localPath = join(process.cwd(), '.cueclaw', 'config.yaml')

  let merged: Record<string, any> = {}

  const globalConfig = loadYamlFile(globalPath)
  if (globalConfig) merged = deepMerge(merged, globalConfig)

  const localConfig = loadYamlFile(localPath)
  if (localConfig) merged = deepMerge(merged, localConfig)

  // Env var overrides
  if (process.env['ANTHROPIC_API_KEY']) {
    merged.claude = merged.claude ?? {}
    ;(merged.claude as Record<string, any>).api_key = process.env['ANTHROPIC_API_KEY']
  }
  if (process.env['ANTHROPIC_BASE_URL']) {
    merged.claude = merged.claude ?? {}
    ;(merged.claude as Record<string, any>).base_url = process.env['ANTHROPIC_BASE_URL']
  }
  if (process.env['TELEGRAM_BOT_TOKEN']) {
    merged.telegram = merged.telegram ?? {}
    ;(merged.telegram as Record<string, any>).token = process.env['TELEGRAM_BOT_TOKEN']
    ;(merged.telegram as Record<string, any>).enabled = true
  }

  // Interpolate ${ENV_VAR} in values
  merged = interpolateObject(merged)

  const result = ConfigSchema.safeParse(merged)
  if (!result.success) {
    const issues = result.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new ConfigError(`Invalid configuration:\n${issues}`)
  }

  return result.data
}

// ─── Default Config Template ───

const DEFAULT_CONFIG = `# CueClaw Configuration
# See docs/config.md for all options

claude:
  api_key: \${ANTHROPIC_API_KEY}
  planner:
    model: claude-sonnet-4-6
  executor:
    model: claude-sonnet-4-6

container:
  enabled: true

logging:
  level: info
`

export function createDefaultConfig(): void {
  const configPath = join(cueclawHome(), 'config.yaml')
  if (!existsSync(configPath)) {
    ensureCueclawHome()
    writeFileSync(configPath, DEFAULT_CONFIG, 'utf-8')
  }
}

// ─── Onboarding Detection ───

/**
 * Check if first-run onboarding is needed.
 * Returns true if config is missing or has no resolved, non-empty API key.
 */
export function needsOnboarding(): boolean {
  const configPath = join(cueclawHome(), 'config.yaml')
  if (!existsSync(configPath)) return true

  const raw = loadYamlFile(configPath)
  if (!raw) return true

  // Check if api_key exists and resolves to a non-empty value
  const apiKey = (raw.claude as Record<string, any> | undefined)?.api_key
  if (!apiKey || typeof apiKey !== 'string') {
    // No api_key in config — check env var
    return !process.env['ANTHROPIC_API_KEY']
  }

  // If it's a placeholder like ${ANTHROPIC_API_KEY}, check if the env var is set
  const resolved = interpolateEnvVars(apiKey)
  return !resolved
}

// ─── Config Validation ───

export interface ConfigIssue {
  field: string
  severity: 'error' | 'warning'
  message: string
}

export interface ConfigValidationResult {
  valid: boolean
  issues: ConfigIssue[]
}

/**
 * Validate config without throwing. Returns issues found.
 * 'error' severity = cannot proceed, 'warning' = suboptimal but functional.
 */
export function validateConfig(): ConfigValidationResult {
  const issues: ConfigIssue[] = []
  const configPath = join(cueclawHome(), 'config.yaml')

  if (!existsSync(configPath)) {
    issues.push({ field: 'config', severity: 'error', message: 'Config file not found. Run setup to create one.' })
    // Check if env var alone is sufficient
    if (!process.env['ANTHROPIC_API_KEY']) {
      return { valid: false, issues }
    }
    // Env var exists — no config file needed
    issues.length = 0
    return { valid: true, issues }
  }

  const raw = loadYamlFile(configPath)
  if (!raw) {
    issues.push({ field: 'config', severity: 'error', message: 'Config file is empty or invalid YAML.' })
    if (!process.env['ANTHROPIC_API_KEY']) {
      return { valid: false, issues }
    }
    issues.length = 0
    return { valid: true, issues }
  }

  // Check API key
  const claude = raw.claude as Record<string, any> | undefined
  const rawApiKey = claude?.api_key as string | undefined
  const resolvedKey = rawApiKey ? interpolateEnvVars(rawApiKey) : process.env['ANTHROPIC_API_KEY']
  if (!resolvedKey) {
    issues.push({ field: 'claude.api_key', severity: 'error', message: 'API key is missing. Set it in config or ANTHROPIC_API_KEY env var.' })
  }

  // Check base_url format
  const baseUrl = claude?.base_url as string | undefined
  if (baseUrl && baseUrl !== 'https://api.anthropic.com') {
    try {
      new URL(baseUrl)
    } catch {
      issues.push({ field: 'claude.base_url', severity: 'error', message: `Invalid base URL: "${baseUrl}"` })
    }
  }

  // Check telegram config
  const telegram = raw.telegram as Record<string, any> | undefined
  if (telegram?.enabled === true) {
    const token = (telegram.token as string | undefined) ?? process.env['TELEGRAM_BOT_TOKEN']
    if (!token) {
      issues.push({ field: 'telegram.token', severity: 'warning', message: 'Telegram is enabled but no bot token is configured.' })
    }
  }

  // Check whatsapp config
  const whatsapp = raw.whatsapp as Record<string, any> | undefined
  if (whatsapp?.enabled === true) {
    const authDir = whatsapp.auth_dir as string | undefined
    if (authDir && !existsSync(authDir.replace('~', homedir()))) {
      issues.push({ field: 'whatsapp.auth_dir', severity: 'warning', message: `WhatsApp auth directory does not exist: ${authDir}` })
    }
  }

  const hasErrors = issues.some(i => i.severity === 'error')
  return { valid: !hasErrors, issues }
}

// ─── Raw Config Reading ───

/** Pre-existing values for onboarding to detect `cueclaw config set` usage. */
export interface ExistingConfig {
  apiKey?: string       // raw value (may be ${ANTHROPIC_API_KEY})
  baseUrl?: string
  containerEnabled?: boolean
  telegramEnabled?: boolean
  telegramToken?: string
  whatsappEnabled?: boolean
}

/**
 * Read raw config file and extract pre-set values (before Zod validation).
 * Used by onboarding to detect keys already set via `cueclaw config set`.
 */
export function loadExistingConfig(): ExistingConfig {
  const configPath = join(cueclawHome(), 'config.yaml')
  const raw = loadYamlFile(configPath)
  if (!raw) return {}

  const claude = raw.claude as Record<string, any> | undefined
  const container = raw.container as Record<string, any> | undefined
  const telegram = raw.telegram as Record<string, any> | undefined
  const whatsapp = raw.whatsapp as Record<string, any> | undefined

  const rawKey = claude?.api_key as string | undefined
  // Resolve ${ENV_VAR} placeholders; keep only truly-set keys
  const resolvedKey = rawKey ? interpolateEnvVars(rawKey) : undefined

  // Env var fallbacks
  const envTelegramToken = process.env['TELEGRAM_BOT_TOKEN']
  const telegramToken = (telegram?.token as string | undefined) ?? envTelegramToken
  const telegramEnabled = telegram?.enabled === true || !!envTelegramToken || undefined

  return {
    apiKey: resolvedKey || undefined,
    baseUrl: claude?.base_url && claude.base_url !== 'https://api.anthropic.com'
      ? (claude.base_url as string)
      : undefined,
    containerEnabled: container?.enabled === true ? true : undefined,
    telegramEnabled,
    telegramToken: telegramToken || undefined,
    whatsappEnabled: whatsapp?.enabled === true ? true : undefined,
  }
}

// ─── Config Writing ───

/**
 * Deep-merge updates into ~/.cueclaw/config.yaml and write.
 */
export function writeConfig(updates: Record<string, any>): void {
  ensureCueclawHome()
  const configPath = join(cueclawHome(), 'config.yaml')

  let existing: Record<string, any> = {}
  if (existsSync(configPath)) {
    const loaded = loadYamlFile(configPath)
    if (loaded) existing = loaded
  }

  const merged = deepMerge(existing, updates)
  writeFileSync(configPath, stringifyYaml(merged), 'utf-8')
}
