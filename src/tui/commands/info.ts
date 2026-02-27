import { registerCommand } from './registry.js'
import { cueclawHome } from '../../config.js'
import { appVersion } from '../version.js'

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
    ctx.addMessage({ type: 'assistant', text: lines.join('\n') })
  },
})
