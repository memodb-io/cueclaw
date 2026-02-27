import { registerCommand } from './registry.js'

registerCommand({
  name: 'bot',
  aliases: [],
  description: 'Manage bot channels',
  usage: '/bot start|status',
  // Handled in use-command-dispatch.ts
  execute() {},
})
