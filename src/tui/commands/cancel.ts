import { registerCommand } from './registry.js'

registerCommand({
  name: 'cancel',
  aliases: [],
  description: 'Cancel current conversation',
  usage: '/cancel',
  // Handled in use-command-dispatch.ts
  execute() {},
})
