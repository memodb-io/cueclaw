import type Database from 'better-sqlite3'
import type { CueclawConfig } from '../config.js'
import type { DaemonBridge } from './daemon-bridge.js'
import type { ChatMessage } from './chat.js'
import { listWorkflows, getWorkflow, getWorkflowRunsByWorkflowId, getStepRunsByRunId, updateWorkflowPhase, deleteWorkflow } from '../db.js'
import { loadConfig, writeConfig, cueclawHome } from '../config.js'
import { getServiceStatus } from '../service.js'
import { appVersion } from './version.js'

// ─── Types ───

export interface CommandContext {
  db: Database.Database
  config: CueclawConfig | null
  cwd: string
  bridge: DaemonBridge | null
  addMessage: (msg: ChatMessage) => void
  clearMessages: () => void
  setConfig: (config: CueclawConfig) => void
}

export interface SlashCommand {
  name: string
  aliases: string[]
  description: string
  usage: string
  execute: (args: string, ctx: CommandContext) => Promise<void> | void
}

// ─── Command Registry ───

const commands: SlashCommand[] = []

function registerCommand(cmd: SlashCommand): void {
  commands.push(cmd)
}

export function getCommands(): SlashCommand[] {
  return commands
}

export function findCommand(name: string): SlashCommand | undefined {
  const lower = name.toLowerCase()
  return commands.find(c => c.name === lower || c.aliases.includes(lower))
}

/** Parse a slash command string. Returns null if not a slash command. */
export function parseSlashCommand(input: string): { name: string; args: string } | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null
  const spaceIdx = trimmed.indexOf(' ')
  if (spaceIdx === -1) {
    return { name: trimmed.slice(1), args: '' }
  }
  return { name: trimmed.slice(1, spaceIdx), args: trimmed.slice(spaceIdx + 1).trim() }
}

// ─── Commands ───

registerCommand({
  name: 'help',
  aliases: ['h', '?'],
  description: 'Show available commands',
  usage: '/help',
  execute(_args, ctx) {
    const lines = commands.map(c => {
      const aliases = c.aliases.length > 0 ? ` (${c.aliases.map(a => '/' + a).join(', ')})` : ''
      return `  /${c.name}${aliases} — ${c.description}`
    })
    ctx.addMessage({ role: 'assistant', text: 'Available commands:\n' + lines.join('\n') })
  },
})

registerCommand({
  name: 'list',
  aliases: ['ls'],
  description: 'List all workflows',
  usage: '/list',
  execute(_args, ctx) {
    const workflows = listWorkflows(ctx.db)
    if (workflows.length === 0) {
      ctx.addMessage({ role: 'assistant', text: 'No workflows found.' })
      return
    }
    const header = `${'ID'.padEnd(14)} ${'Name'.padEnd(28)} ${'Phase'.padEnd(14)} Trigger`
    const rows = workflows.map(wf => {
      const trigger = wf.trigger.type === 'poll'
        ? `poll (${wf.trigger.interval_seconds}s)`
        : wf.trigger.type === 'cron'
          ? `cron (${wf.trigger.expression})`
          : 'manual'
      return `${wf.id.slice(0, 12).padEnd(14)} ${wf.name.slice(0, 26).padEnd(28)} ${wf.phase.padEnd(14)} ${trigger}`
    })
    ctx.addMessage({ role: 'assistant', text: `Workflows (${workflows.length}):\n${header}\n${rows.join('\n')}` })
  },
})

registerCommand({
  name: 'status',
  aliases: ['st'],
  description: 'View workflow status',
  usage: '/status [id]',
  execute(args, ctx) {
    if (!args) {
      findCommand('list')!.execute('', ctx)
      return
    }

    const wf = getWorkflow(ctx.db, args) ?? findWorkflowByPrefix(ctx.db, args)
    if (!wf) {
      ctx.addMessage({ role: 'assistant', text: `Workflow not found: ${args}` })
      return
    }

    const trigger = wf.trigger.type === 'poll'
      ? `poll (${wf.trigger.interval_seconds}s)`
      : wf.trigger.type === 'cron'
        ? `cron (${wf.trigger.expression})`
        : 'manual'

    let detail = `Workflow: ${wf.name}\nID: ${wf.id}\nPhase: ${wf.phase}\nTrigger: ${trigger}\nCreated: ${wf.created_at}\n\nSteps:`
    for (const step of wf.steps) {
      const deps = step.depends_on.length > 0 ? ` (after: ${step.depends_on.join(', ')})` : ''
      detail += `\n  - ${step.id}: ${step.description.slice(0, 80)}${deps}`
    }

    const runs = getWorkflowRunsByWorkflowId(ctx.db, wf.id)
    if (runs.length > 0) {
      const latest = runs[0]!
      detail += `\n\nLatest Run: ${latest.status}`
      if (latest.error) detail += ` — ${latest.error}`

      const stepRuns = getStepRunsByRunId(ctx.db, latest.id)
      if (stepRuns.length > 0) {
        detail += '\nStep Results:'
        for (const sr of stepRuns) {
          const output = sr.output_json ? ` — ${sr.output_json.slice(0, 60)}` : ''
          detail += `\n  ${sr.step_id}: ${sr.status}${output}`
        }
      }
    }

    ctx.addMessage({ role: 'assistant', text: detail })
  },
})

registerCommand({
  name: 'pause',
  aliases: [],
  description: 'Pause a workflow',
  usage: '/pause <id>',
  execute(args, ctx) {
    if (!args) {
      ctx.addMessage({ role: 'assistant', text: 'Usage: /pause <workflow-id>' })
      return
    }
    const wf = getWorkflow(ctx.db, args) ?? findWorkflowByPrefix(ctx.db, args)
    if (!wf) {
      ctx.addMessage({ role: 'assistant', text: `Workflow not found: ${args}` })
      return
    }
    if (wf.phase !== 'active') {
      ctx.addMessage({ role: 'assistant', text: `Cannot pause workflow in phase "${wf.phase}" (must be "active")` })
      return
    }
    updateWorkflowPhase(ctx.db, wf.id, 'paused')
    ctx.addMessage({ role: 'assistant', text: `Paused workflow "${wf.name}" (${wf.id})` })
  },
})

registerCommand({
  name: 'resume',
  aliases: [],
  description: 'Resume a paused workflow',
  usage: '/resume <id>',
  execute(args, ctx) {
    if (!args) {
      ctx.addMessage({ role: 'assistant', text: 'Usage: /resume <workflow-id>' })
      return
    }
    const wf = getWorkflow(ctx.db, args) ?? findWorkflowByPrefix(ctx.db, args)
    if (!wf) {
      ctx.addMessage({ role: 'assistant', text: `Workflow not found: ${args}` })
      return
    }
    if (wf.phase !== 'paused') {
      ctx.addMessage({ role: 'assistant', text: `Cannot resume workflow in phase "${wf.phase}" (must be "paused")` })
      return
    }
    const nextPhase = wf.trigger.type === 'manual' ? 'executing' : 'active'
    updateWorkflowPhase(ctx.db, wf.id, nextPhase)
    ctx.addMessage({ role: 'assistant', text: `Resumed workflow "${wf.name}" — phase: ${nextPhase}` })
  },
})

registerCommand({
  name: 'delete',
  aliases: ['rm'],
  description: 'Delete a workflow',
  usage: '/delete <id>',
  execute(args, ctx) {
    if (!args) {
      ctx.addMessage({ role: 'assistant', text: 'Usage: /delete <workflow-id>' })
      return
    }
    const wf = getWorkflow(ctx.db, args) ?? findWorkflowByPrefix(ctx.db, args)
    if (!wf) {
      ctx.addMessage({ role: 'assistant', text: `Workflow not found: ${args}` })
      return
    }
    if (wf.phase === 'executing') {
      ctx.addMessage({ role: 'assistant', text: 'Cannot delete workflow while it is executing.' })
      return
    }
    deleteWorkflow(ctx.db, wf.id)
    ctx.addMessage({ role: 'assistant', text: `Deleted workflow "${wf.name}" (${wf.id})` })
  },
})

registerCommand({
  name: 'config',
  aliases: ['cfg'],
  description: 'View or set configuration',
  usage: '/config get [key] | /config set <key> <value>',
  execute(args, ctx) {
    const parts = args.split(/\s+/)
    const subcommand = parts[0]?.toLowerCase()

    if (!subcommand || subcommand === 'get') {
      const key = parts[1]
      try {
        const config = loadConfig()
        if (!key) {
          ctx.addMessage({ role: 'assistant', text: 'Configuration:\n' + JSON.stringify(config, null, 2) })
          return
        }
        const keyParts = key.split('.')
        let value: any = config
        for (const p of keyParts) {
          if (value === null || value === undefined) break
          value = (value as Record<string, any>)[p]
        }
        ctx.addMessage({ role: 'assistant', text: value !== undefined ? `${key} = ${JSON.stringify(value, null, 2)}` : `Key not found: ${key}` })
      } catch (err) {
        ctx.addMessage({ role: 'assistant', text: `Error loading config: ${err instanceof Error ? err.message : String(err)}` })
      }
      return
    }

    if (subcommand === 'set') {
      const key = parts[1]
      const value = parts.slice(2).join(' ')
      if (!key || !value) {
        ctx.addMessage({ role: 'assistant', text: 'Usage: /config set <key> <value>' })
        return
      }

      try {
        let parsed: any = value
        if (value === 'true') parsed = true
        else if (value === 'false') parsed = false
        else if (/^\d+$/.test(value)) parsed = Number(value)

        const keyParts = key.split('.')
        const update: Record<string, any> = {}
        let target: any = update
        for (let i = 0; i < keyParts.length - 1; i++) {
          target[keyParts[i]!] = {}
          target = target[keyParts[i]!]
        }
        target[keyParts[keyParts.length - 1]!] = parsed

        writeConfig(update)
        const newConfig = loadConfig()
        ctx.setConfig(newConfig)
        ctx.addMessage({ role: 'assistant', text: `Set ${key} = ${JSON.stringify(parsed)}` })
      } catch (err) {
        ctx.addMessage({ role: 'assistant', text: `Error setting config: ${err instanceof Error ? err.message : String(err)}` })
      }
      return
    }

    ctx.addMessage({ role: 'assistant', text: 'Usage: /config get [key] | /config set <key> <value>' })
  },
})

registerCommand({
  name: 'daemon',
  aliases: [],
  description: 'View daemon status',
  usage: '/daemon status|start|stop',
  execute(args, ctx) {
    const subcommand = args.trim().toLowerCase() || 'status'

    if (subcommand === 'status') {
      const status = getServiceStatus()
      const bridgeStatus = ctx.bridge
        ? ctx.bridge.isExternal ? 'external service' : 'in-process'
        : 'not connected'
      ctx.addMessage({ role: 'assistant', text: `Daemon status: ${status}\nBridge: ${bridgeStatus}` })
      return
    }

    if (subcommand === 'start' || subcommand === 'stop') {
      ctx.addMessage({ role: 'assistant', text: `Use the CLI for daemon ${subcommand}: cueclaw daemon ${subcommand}` })
      return
    }

    ctx.addMessage({ role: 'assistant', text: 'Usage: /daemon status|start|stop' })
  },
})

registerCommand({
  name: 'info',
  aliases: [],
  description: 'Show system information',
  usage: '/info',
  execute(_args, ctx) {
    const config = ctx.config
    const lines = [
      `CueClaw ${appVersion === 'dev' ? 'dev' : `v${appVersion}`}`,
      `Working directory: ${ctx.cwd}`,
      `Config directory: ${cueclawHome()}`,
      '',
    ]
    if (config) {
      lines.push(`Planner model: ${config.claude.planner.model}`)
      lines.push(`Executor model: ${config.claude.executor.model}`)
      lines.push(`Base URL: ${config.claude.base_url}`)
      if (config.telegram?.enabled) lines.push('Telegram: enabled')
      if (config.whatsapp?.enabled) lines.push('WhatsApp: enabled')
      if (config.container?.enabled) lines.push('Container isolation: enabled')
    }
    ctx.addMessage({ role: 'assistant', text: lines.join('\n') })
  },
})

registerCommand({
  name: 'clear',
  aliases: ['cls'],
  description: 'Clear chat messages',
  usage: '/clear',
  execute(_args, ctx) {
    ctx.clearMessages()
  },
})

registerCommand({
  name: 'new',
  aliases: [],
  description: 'Generate a plan directly (skip conversation)',
  usage: '/new <description>',
  execute(args, ctx) {
    if (!args) {
      ctx.addMessage({ role: 'assistant', text: 'Usage: /new <workflow description>' })
      return
    }
    // Actual execution handled in app.tsx (needs async planner call)
    ctx.addMessage({ role: 'assistant', text: 'Generating plan...' })
  },
})

registerCommand({
  name: 'cancel',
  aliases: [],
  description: 'Cancel current conversation',
  usage: '/cancel',
  execute(_args, ctx) {
    // Handled specially in app.tsx to reset planner session
    ctx.addMessage({ role: 'assistant', text: 'Conversation cancelled.' })
  },
})

registerCommand({
  name: 'bot',
  aliases: [],
  description: 'Manage bot channels',
  usage: '/bot start|status',
  execute(args, ctx) {
    const subcommand = args.trim().toLowerCase() || 'status'

    if (subcommand === 'status') {
      const config = ctx.config
      const tg = config?.telegram?.enabled ? 'enabled' : 'disabled'
      const wa = config?.whatsapp?.enabled ? 'enabled' : 'disabled'
      ctx.addMessage({ role: 'assistant', text: `Telegram: ${tg}\nWhatsApp: ${wa}` })
      return
    }

    if (subcommand === 'start') {
      // Actual start handled in app.tsx (needs async bridge call)
      return
    }

    ctx.addMessage({ role: 'assistant', text: 'Usage: /bot start|status' })
  },
})

registerCommand({
  name: 'setup',
  aliases: [],
  description: 'Re-run configuration setup',
  usage: '/setup',
  execute(_args, ctx) {
    // Handled in app.tsx to switch to onboarding view
    ctx.addMessage({ role: 'assistant', text: 'Starting setup wizard...' })
  },
})

// ─── Helpers ───

function findWorkflowByPrefix(db: Database.Database, prefix: string) {
  const all = listWorkflows(db)
  return all.find(wf => wf.id.startsWith(prefix))
}
