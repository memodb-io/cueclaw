import { registerCommand } from './registry.js'

registerCommand({
  name: 'setup',
  aliases: [],
  description: 'Re-run configuration setup',
  usage: '/setup',
  // Handled in use-command-dispatch.ts
  execute() {},
})
