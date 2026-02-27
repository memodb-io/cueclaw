import { registerCommand } from './registry.js'
import { getServiceStatus } from '../../service.js'

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
      ctx.addMessage({ type: 'assistant', text: `Daemon status: ${status}\nBridge: ${bridgeStatus}` })
      return
    }

    if (subcommand === 'start' || subcommand === 'stop') {
      ctx.addMessage({ type: 'assistant', text: `Use the CLI for daemon ${subcommand}: cueclaw daemon ${subcommand}` })
      return
    }

    ctx.addMessage({ type: 'assistant', text: 'Usage: /daemon status|start|stop' })
  },
})
