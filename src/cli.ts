#!/usr/bin/env node

import { Command } from 'commander'
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { loadConfig, ensureCueclawHome, createDefaultConfig, cueclawHome } from './config.js'
import { initDb, listWorkflows, insertWorkflow, getWorkflow, updateWorkflowPhase, deleteWorkflow, getWorkflowRunsByWorkflowId, getStepRunsByRunId } from './db.js'
import { loadSecrets } from './env.js'
import { logger } from './logger.js'

const require = createRequire(import.meta.url)
const { version: pkgVersion } = require('../package.json') as { version: string }

const program = new Command()
  .name('cueclaw')
  .description('Orchestrate agent workflows with natural language')
  .version(pkgVersion)

// ─── info ───

program.command('info')
  .description('Show loaded config, paths, versions')
  .action(() => {
    try {
      const config = loadConfig()
      logger.info({
        model_planner: config.claude.planner.model,
        model_executor: config.claude.executor.model,
        whatsapp: config.whatsapp?.enabled ?? false,
        telegram: config.telegram?.enabled ?? false,
        container: config.container?.enabled ?? false,
        log_level: config.logging?.level ?? 'info',
      }, 'CueClaw configuration')
    } catch (err) {
      logger.error({ err }, 'Failed to load config')
      process.exit(1)
    }
  })

// ─── config ───

const configCmd = program.command('config').description('Manage configuration')

configCmd.command('get')
  .argument('[key]', 'Config key (dot notation)')
  .description('Get config value')
  .action((key?: string) => {
    try {
      const config = loadConfig()
      if (!key) {
        console.log(JSON.stringify(config, null, 2))
        return
      }
      const parts = key.split('.')
      let value: any = config
      for (const part of parts) {
        if (value === null || value === undefined) break
        value = (value as Record<string, any>)[part]
      }
      console.log(value !== undefined ? JSON.stringify(value, null, 2) : 'Key not found')
    } catch (err) {
      logger.error({ err }, 'Failed to load config')
      process.exit(1)
    }
  })

configCmd.command('set')
  .argument('<key>', 'Config key (dot notation, e.g. claude.executor.model)')
  .argument('<value>', 'Value to set')
  .description('Set config value')
  .action(async (key: string, value: string) => {
    try {
      const { readFileSync, writeFileSync, existsSync } = await import('node:fs')
      const { join } = await import('node:path')
      const { parse: parseYaml, stringify: stringifyYaml } = await import('yaml')
      const { isDev, writeEnvVar } = await import('./env.js')

      const configPath = join(cueclawHome(), 'config.yaml')
      if (!existsSync(configPath)) {
        createDefaultConfig()
      }

      const content = readFileSync(configPath, 'utf-8')
      const doc = parseYaml(content) ?? {}

      // Env-backed keys: dev writes to .env, production writes to config.yaml
      const envVarMap: Record<string, string> = {
        'claude.api_key': 'ANTHROPIC_API_KEY',
        'claude.base_url': 'ANTHROPIC_BASE_URL',
      }
      const envVar = envVarMap[key]

      if (isDev && envVar) {
        // Dev mode: only write to .env, leave config.yaml placeholder untouched
        writeEnvVar(envVar, value)
        console.log(`Set ${key} (stored in .env as ${envVar})`)
      } else {
        // Production mode (or non-sensitive key): write to config.yaml
        let parsed: any = value
        if (value === 'true') parsed = true
        else if (value === 'false') parsed = false
        else if (/^\d+$/.test(value)) parsed = Number(value)

        const parts = key.split('.')
        let target: any = doc
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i]!
          if (target[part] === undefined || target[part] === null || typeof target[part] !== 'object') {
            target[part] = {}
          }
          target = target[part]
        }
        target[parts[parts.length - 1]!] = parsed

        writeFileSync(configPath, stringifyYaml(doc), 'utf-8')
        console.log(`Set ${key} = ${JSON.stringify(parsed)}`)
      }
    } catch (err) {
      logger.error({ err }, 'Failed to set config')
      process.exit(1)
    }
  })

// ─── Workflow management stubs ───

program.command('new')
  .description('Create a new workflow from a natural language description')
  .argument('<description>', 'Workflow description in natural language')
  .action(async (description: string) => {
    try {
      const config = loadConfig()
      const { generatePlan, confirmPlan } = await import('./planner.js')
      const { executeWorkflow } = await import('./executor.js')

      console.log('Planning workflow...')
      const workflow = await generatePlan(description, config)

      console.log(`\nWorkflow: ${workflow.name}`)
      console.log(`Trigger:  ${workflow.trigger.type}`)
      console.log(`Steps:`)
      for (const step of workflow.steps) {
        const deps = step.depends_on.length > 0 ? ` (after: ${step.depends_on.join(', ')})` : ''
        console.log(`  - ${step.id}: ${step.description.slice(0, 80)}${step.description.length > 80 ? '...' : ''}${deps}`)
      }

      const rl = createInterface({ input: process.stdin, output: process.stdout })
      const answer = await new Promise<string>(resolve => {
        rl.question('\nConfirm and execute? (y/N) ', resolve)
      })
      rl.close()

      if (answer.toLowerCase() !== 'y') {
        console.log('Cancelled.')
        return
      }

      ensureCueclawHome()
      const db = initDb()
      insertWorkflow(db, workflow)
      const confirmed = confirmPlan(workflow)
      updateWorkflowPhase(db, confirmed.id, confirmed.phase)

      if (confirmed.phase === 'executing') {
        console.log('\nExecuting workflow...')
        const result = await executeWorkflow({
          workflow: confirmed,
          triggerData: null,
          db,
          cwd: process.cwd(),
          onProgress: (stepId, msg) => {
            if (msg?.status) console.log(`  [${stepId}] ${msg.status}`)
          },
        })
        console.log(`\nWorkflow ${result.status}. Run ID: ${result.runId}`)
      } else {
        console.log(`\nWorkflow saved as "${confirmed.phase}". ID: ${confirmed.id}`)
      }

      db.close()
    } catch (err) {
      logger.error({ err }, 'Failed to create workflow')
      process.exit(1)
    }
  })

program.command('list')
  .description('List all workflows')
  .action(() => {
    try {
      ensureCueclawHome()
      const db = initDb()
      const workflows = listWorkflows(db)
      if (workflows.length === 0) {
        console.log('No workflows found.')
        return
      }
      for (const wf of workflows) {
        console.log(`  ${wf.id}  ${wf.phase.padEnd(22)}  ${wf.name}`)
      }
      db.close()
    } catch (err) {
      logger.error({ err }, 'Failed to list workflows')
      process.exit(1)
    }
  })

program.command('status')
  .argument('[workflow-id]', 'Workflow ID')
  .description('View workflow status')
  .action((workflowId?: string) => {
    try {
      ensureCueclawHome()
      const db = initDb()

      if (!workflowId) {
        const workflows = listWorkflows(db)
        if (workflows.length === 0) {
          console.log('No workflows found.')
          db.close()
          return
        }
        console.log('Workflows:\n')
        for (const wf of workflows) {
          console.log(`  ${wf.id}  ${wf.phase.padEnd(22)}  ${wf.name}`)
          console.log(`    Trigger: ${wf.trigger.type}  |  Steps: ${wf.steps.length}  |  Updated: ${wf.updated_at}`)
        }
        db.close()
        return
      }

      const wf = getWorkflow(db, workflowId)
      if (!wf) {
        console.error(`Workflow not found: ${workflowId}`)
        db.close()
        process.exit(1)
      }

      console.log(`Workflow: ${wf.name}`)
      console.log(`ID:      ${wf.id}`)
      console.log(`Phase:   ${wf.phase}`)
      console.log(`Trigger: ${wf.trigger.type}`)
      console.log(`Created: ${wf.created_at}`)
      console.log(`Updated: ${wf.updated_at}`)
      console.log(`\nSteps:`)
      for (const step of wf.steps) {
        const deps = step.depends_on.length > 0 ? ` (after: ${step.depends_on.join(', ')})` : ''
        console.log(`  - ${step.id}: ${step.description.slice(0, 100)}${step.description.length > 100 ? '...' : ''}${deps}`)
      }

      const runs = getWorkflowRunsByWorkflowId(db, workflowId)
      if (runs.length > 0) {
        const latest = runs[0]!
        console.log(`\nLatest Run: ${latest.id}`)
        console.log(`  Status:  ${latest.status}`)
        console.log(`  Started: ${latest.started_at}`)
        if (latest.completed_at) console.log(`  Ended:   ${latest.completed_at}`)
        if (latest.error) console.log(`  Error:   ${latest.error}`)

        const stepRuns = getStepRunsByRunId(db, latest.id)
        if (stepRuns.length > 0) {
          console.log(`  Step Results:`)
          for (const sr of stepRuns) {
            const output = sr.output_json ? ` — ${sr.output_json.slice(0, 60)}${sr.output_json.length > 60 ? '...' : ''}` : ''
            console.log(`    ${sr.step_id}: ${sr.status}${output}`)
          }
        }
      }

      db.close()
    } catch (err) {
      logger.error({ err }, 'Failed to get workflow status')
      process.exit(1)
    }
  })

program.command('pause')
  .argument('<workflow-id>', 'Workflow ID')
  .description('Pause a workflow')
  .action((workflowId: string) => {
    try {
      ensureCueclawHome()
      const db = initDb()
      const wf = getWorkflow(db, workflowId)
      if (!wf) {
        console.error(`Workflow not found: ${workflowId}`)
        db.close()
        process.exit(1)
      }
      if (wf.phase !== 'active') {
        console.error(`Cannot pause workflow in phase "${wf.phase}" (must be "active")`)
        db.close()
        process.exit(1)
      }
      updateWorkflowPhase(db, workflowId, 'paused')
      console.log(`Paused workflow "${wf.name}" (${workflowId})`)
      db.close()
    } catch (err) {
      logger.error({ err }, 'Failed to pause workflow')
      process.exit(1)
    }
  })

program.command('resume')
  .argument('<workflow-id>', 'Workflow ID')
  .description('Resume a paused workflow')
  .action(async (workflowId: string) => {
    try {
      ensureCueclawHome()
      const db = initDb()
      const wf = getWorkflow(db, workflowId)
      if (!wf) {
        console.error(`Workflow not found: ${workflowId}`)
        db.close()
        process.exit(1)
      }
      if (wf.phase !== 'paused') {
        console.error(`Cannot resume workflow in phase "${wf.phase}" (must be "paused")`)
        db.close()
        process.exit(1)
      }

      if (wf.trigger.type === 'manual') {
        updateWorkflowPhase(db, workflowId, 'executing')
        console.log(`Executing workflow "${wf.name}"...`)
        const { executeWorkflow } = await import('./executor.js')
        const result = await executeWorkflow({
          workflow: { ...wf, phase: 'executing' },
          triggerData: null,
          db,
          cwd: process.cwd(),
          onProgress: (stepId, msg) => {
            if (msg?.status) console.log(`  [${stepId}] ${msg.status}`)
          },
        })
        console.log(`Workflow ${result.status}. Run ID: ${result.runId}`)
      } else {
        updateWorkflowPhase(db, workflowId, 'active')
        console.log(`Resumed workflow "${wf.name}" (${workflowId})`)
      }

      db.close()
    } catch (err) {
      logger.error({ err }, 'Failed to resume workflow')
      process.exit(1)
    }
  })

program.command('delete')
  .argument('<workflow-id>', 'Workflow ID')
  .description('Delete a workflow')
  .action(async (workflowId: string) => {
    try {
      ensureCueclawHome()
      const db = initDb()
      const wf = getWorkflow(db, workflowId)
      if (!wf) {
        console.error(`Workflow not found: ${workflowId}`)
        db.close()
        process.exit(1)
      }
      if (wf.phase === 'executing') {
        console.error(`Cannot delete workflow while it is executing`)
        db.close()
        process.exit(1)
      }

      const rl = createInterface({ input: process.stdin, output: process.stdout })
      const answer = await new Promise<string>(resolve => {
        rl.question(`Delete workflow "${wf.name}" (${workflowId})? (y/N) `, resolve)
      })
      rl.close()

      if (answer.toLowerCase() !== 'y') {
        console.log('Cancelled.')
        db.close()
        return
      }

      deleteWorkflow(db, workflowId)
      console.log(`Deleted workflow "${wf.name}" (${workflowId})`)
      db.close()
    } catch (err) {
      logger.error({ err }, 'Failed to delete workflow')
      process.exit(1)
    }
  })

// ─── Daemon stubs ───

const daemonCmd = program.command('daemon').description('Manage background daemon')

daemonCmd.command('start')
  .option('--detach', 'Run in background')
  .description('Start the daemon')
  .action(async (opts: { detach?: boolean }) => {
    if (opts.detach) {
      const { spawn } = await import('node:child_process')
      const child = spawn(process.execPath, [process.argv[1]!, 'daemon', 'start'], {
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
      console.log(`Daemon started in background (PID ${child.pid})`)
      return
    }
    try {
      const { startDaemon } = await import('./daemon.js')
      await startDaemon()
    } catch (err) {
      logger.error({ err }, 'Daemon failed')
      process.exit(1)
    }
  })

daemonCmd.command('stop')
  .description('Stop the daemon')
  .action(async () => {
    const { getServiceStatus, stopService } = await import('./service.js')
    const status = getServiceStatus()
    if (status !== 'running') {
      console.log('Daemon is not running.')
      return
    }
    const result = stopService()
    if (result.success) {
      console.log('Daemon stopped.')
    } else {
      console.log(`Failed to stop daemon: ${result.error}`)
      process.exit(1)
    }
  })

daemonCmd.command('restart')
  .description('Restart the daemon')
  .action(async () => {
    const { getServiceStatus, stopService } = await import('./service.js')
    const status = getServiceStatus()
    if (status === 'running') {
      const result = stopService()
      if (!result.success) {
        console.log(`Failed to stop daemon: ${result.error}`)
        process.exit(1)
      }
      console.log('Daemon stopped.')
    }
    const { startDaemon } = await import('./daemon.js')
    await startDaemon()
  })

daemonCmd.command('install')
  .description('Install system service')
  .action(async () => {
    const { installService } = await import('./service.js')
    const result = installService()
    if (result.success) {
      console.log('Service installed successfully.')
    } else {
      console.log(`Install failed: ${result.error}`)
      process.exit(1)
    }
  })

daemonCmd.command('uninstall')
  .description('Remove system service')
  .action(async () => {
    const { uninstallService } = await import('./service.js')
    const result = uninstallService()
    if (result.success) {
      console.log('Service uninstalled successfully.')
    } else {
      console.log(`Uninstall failed: ${result.error}`)
      process.exit(1)
    }
  })

daemonCmd.command('status')
  .description('View daemon status')
  .action(async () => {
    const { getServiceStatus } = await import('./service.js')
    const status = getServiceStatus()
    console.log(`Daemon status: ${status}`)
  })

daemonCmd.command('logs')
  .description('View daemon logs')
  .action(async () => {
    const { join } = await import('node:path')
    const { cueclawHome } = await import('./config.js')
    const logPath = join(cueclawHome(), 'logs', 'daemon.log')
    const { existsSync } = await import('node:fs')
    if (!existsSync(logPath)) {
      console.log('No daemon log file found.')
      return
    }
    const { spawn } = await import('node:child_process')
    spawn('tail', ['-f', logPath], { stdio: 'inherit' })
  })

// ─── Bot stubs ───

const botCmd = program.command('bot').description('Manage bot channels')

botCmd.command('start')
  .description('Start all configured bot channels')
  .action(async () => {
    try {
      const config = loadConfig()
      const db = initDb()
      const { MessageRouter } = await import('./router.js')
      const router = new MessageRouter(db, config, process.cwd())

      if (config.whatsapp?.enabled) {
        const { WhatsAppChannel } = await import('./channels/whatsapp.js')
        const wa = new WhatsAppChannel(
          config.whatsapp.auth_dir ?? `${process.env['HOME']}/.cueclaw/auth/whatsapp`,
          config.whatsapp.allowed_jids ?? [],
          (jid, msg) => router.handleInbound('whatsapp', jid, msg),
        )
        router.registerChannel(wa)
        await wa.connect()
        logger.info('WhatsApp channel started')
      }

      if (config.telegram?.enabled) {
        const { TelegramChannel } = await import('./channels/telegram.js')
        const tg = new TelegramChannel(
          config.telegram.token!,
          config.telegram.allowed_users ?? [],
          (jid, msg) => router.handleInbound('telegram', jid, msg),
        )
        router.registerChannel(tg)
        await tg.connect()
        tg.onCallback((wfId, action, chatId) => router.handleCallbackAction('telegram', chatId, wfId, action))
        logger.info('Telegram channel started')
      }

      router.start()
      console.log('Bot channels started. Press Ctrl+C to stop.')
    } catch (err) {
      logger.error({ err }, 'Failed to start bot channels')
      process.exit(1)
    }
  })

botCmd.command('status')
  .description('View channel connection status')
  .action(() => {
    const config = loadConfig()
    console.log(`WhatsApp: ${config.whatsapp?.enabled ? 'enabled' : 'disabled'}`)
    console.log(`Telegram: ${config.telegram?.enabled ? 'enabled' : 'disabled'}`)
  })

// ─── Setup ───

program.command('setup')
  .description('First-run setup: validate Docker, build container, smoke test')
  .action(async () => {
    try {
      const config = loadConfig()
      const { runSetup } = await import('./setup.js')
      await runSetup(config, process.cwd())
    } catch (err) {
      logger.error({ err }, 'Setup failed')
      process.exit(1)
    }
  })

// ─── TUI stub ───

program.command('tui')
  .description('Start interactive TUI')
  .option('--skip-onboarding', 'Skip first-run onboarding wizard')
  .action(async (opts: { skipOnboarding?: boolean }) => {
    try {
      const { enableTuiLogging } = await import('./logger.js')
      enableTuiLogging()
      const React = await import('react')
      const { render } = await import('ink')
      const { App } = await import('./tui/app.js')
      render(React.createElement(App, { cwd: process.cwd(), skipOnboarding: opts.skipOnboarding }))
    } catch (err) {
      logger.error({ err }, 'Failed to start TUI')
      process.exit(1)
    }
  })

// ─── Default command ───

program
  .option('--skip-onboarding', 'Skip first-run onboarding wizard')
  .action(async (_opts: Record<string, unknown>, cmd: Command) => {
  const skipOnboarding = cmd.opts().skipOnboarding as boolean | undefined
  try {
    const { enableTuiLogging } = await import('./logger.js')
    enableTuiLogging()
    const React = await import('react')
    const { render } = await import('ink')
    const { App } = await import('./tui/app.js')
    render(React.createElement(App, { cwd: process.cwd(), skipOnboarding }))
  } catch (err) {
    logger.error({ err }, 'Failed to start TUI')
    process.exit(1)
  }
})
// ─── Bootstrap ───

loadSecrets()
ensureCueclawHome()
createDefaultConfig()
program.parse()
