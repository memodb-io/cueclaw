import { registerCommand } from './registry.js'
import { loadConfig, writeConfig } from '../../config.js'

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
          ctx.addMessage({ type: 'assistant', text: 'Configuration:\n' + JSON.stringify(config, null, 2) })
          return
        }
        const keyParts = key.split('.')
        let value: any = config
        for (const p of keyParts) {
          if (value === null || value === undefined) break
          value = (value as Record<string, any>)[p]
        }
        ctx.addMessage({ type: 'assistant', text: value !== undefined ? `${key} = ${JSON.stringify(value, null, 2)}` : `Key not found: ${key}` })
      } catch (err) {
        ctx.addMessage({ type: 'error', text: `Error loading config: ${err instanceof Error ? err.message : String(err)}` })
      }
      return
    }

    if (subcommand === 'set') {
      const key = parts[1]
      const value = parts.slice(2).join(' ')
      if (!key || !value) {
        ctx.addMessage({ type: 'assistant', text: 'Usage: /config set <key> <value>' })
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
        ctx.addMessage({ type: 'assistant', text: `Set ${key} = ${JSON.stringify(parsed)}` })
      } catch (err) {
        ctx.addMessage({ type: 'error', text: `Error setting config: ${err instanceof Error ? err.message : String(err)}` })
      }
      return
    }

    ctx.addMessage({ type: 'assistant', text: 'Usage: /config get [key] | /config set <key> <value>' })
  },
})
