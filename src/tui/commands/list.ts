import { registerCommand } from './registry.js'

registerCommand({
  name: 'list',
  aliases: ['ls'],
  description: 'List all workflows',
  usage: '/list',
  // Handled in use-command-dispatch.ts
  execute() {},
})
