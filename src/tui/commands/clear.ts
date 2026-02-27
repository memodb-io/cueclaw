import { registerCommand } from './registry.js'

registerCommand({
  name: 'clear',
  aliases: ['cls'],
  description: 'Clear chat messages',
  usage: '/clear',
  // Handled in use-command-dispatch.ts
  execute() {},
})
