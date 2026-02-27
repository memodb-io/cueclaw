import { registerCommand } from './registry.js'

registerCommand({
  name: 'status',
  aliases: ['st'],
  description: 'View workflow status',
  usage: '/status [id]',
  // Handled in use-command-dispatch.ts
  execute() {},
})
