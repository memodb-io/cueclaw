import { registerCommand } from './registry.js'

registerCommand({
  name: 'new',
  aliases: [],
  description: 'Generate a plan directly (skip conversation)',
  usage: '/new <description>',
  // Handled in use-command-dispatch.ts
  execute() {},
})
