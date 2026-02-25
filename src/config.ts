import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod/v4'
import { ConfigError } from './types.js'

// ─── Zod Schema ───

const ConfigSchema = z.object({
  claude: z.object({
    api_key: z.string(),
    base_url: z.string().url().default('https://api.anthropic.com'),
    planner: z.object({ model: z.string().default('claude-sonnet-4-6') }).default({ model: 'claude-sonnet-4-6' }),
    executor: z.object({ model: z.string().default('claude-sonnet-4-6') }).default({ model: 'claude-sonnet-4-6' }),
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
    enabled: z.boolean().default(false),
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
