#!/usr/bin/env node

import { Command } from 'commander'
import { loadConfig, ensureCueclawHome, createDefaultConfig } from './config.js'
import { initDb, listWorkflows } from './db.js'
import { loadSecrets } from './env.js'
import { logger } from './logger.js'

const program = new Command()
  .name('cueclaw')
  .description('Orchestrate agent workflows with natural language')
  .version('0.0.1')

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

// ─── Workflow management stubs ───

program.command('new')
  .description('Create a new workflow interactively')
  .action(() => { console.log('Workflow creation coming in Phase 1') })

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
  .action(() => { console.log('Status view coming in Phase 1') })

program.command('pause')
  .argument('<workflow-id>', 'Workflow ID')
  .description('Pause a workflow')
  .action(() => { console.log('Pause coming in Phase 1') })

program.command('resume')
  .argument('<workflow-id>', 'Workflow ID')
  .description('Resume a paused workflow')
  .action(() => { console.log('Resume coming in Phase 1') })

program.command('delete')
  .argument('<workflow-id>', 'Workflow ID')
  .description('Delete a workflow')
  .action(() => { console.log('Delete coming in Phase 1') })

// ─── Daemon stubs ───

const daemonCmd = program.command('daemon').description('Manage background daemon')

daemonCmd.command('start')
  .option('--detach', 'Run in background')
  .description('Start the daemon')
  .action(async () => {
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
  .action(() => {
    // In service mode, stop is handled by launchctl/systemctl
    console.log('Use launchctl unload (macOS) or systemctl --user stop cueclaw (Linux)')
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
  .option('--no-banner', 'Skip the startup banner')
  .action(async (opts: { banner?: boolean }) => {
    try {
      const React = await import('react')
      const { render } = await import('ink')
      const { App } = await import('./tui/app.js')
      render(React.createElement(App, { noBanner: opts.banner === false, cwd: process.cwd() }))
    } catch (err) {
      logger.error({ err }, 'Failed to start TUI')
      process.exit(1)
    }
  })

// ─── Default command ───

program.action(async () => {
  try {
    const React = await import('react')
    const { render } = await import('ink')
    const { App } = await import('./tui/app.js')
    render(React.createElement(App, { cwd: process.cwd() }))
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
