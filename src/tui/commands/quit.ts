import { registerCommand } from './registry.js'

registerCommand({
  name: 'quit',
  aliases: ['exit', 'q'],
  description: 'Exit CueClaw',
  usage: '/quit',
  execute() {
    // Handled as special case in useCommandDispatch
  },
})
