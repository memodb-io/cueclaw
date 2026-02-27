import { registerCommand, getCommands } from './registry.js'

registerCommand({
  name: 'help',
  aliases: ['h', '?'],
  description: 'Show available commands',
  usage: '/help',
  execute(_args, ctx) {
    const commands = getCommands()
    const lines = commands.map(c => {
      const aliases = c.aliases.length > 0 ? ` (${c.aliases.map(a => '/' + a).join(', ')})` : ''
      return `  /${c.name}${aliases} — ${c.description}`
    })
    ctx.addMessage({ type: 'assistant', text: 'Available commands:\n' + lines.join('\n') })
  },
})
