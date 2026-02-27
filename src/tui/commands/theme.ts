import { registerCommand } from './registry.js'
import { themeManager } from '../theme/index.js'

registerCommand({
  name: 'theme',
  aliases: [],
  description: 'Switch color theme',
  usage: '/theme [dark|light|dracula]',
  completion: ['dark', 'light', 'dracula'],
  execute(args, ctx) {
    const name = args.trim().toLowerCase()

    if (!name) {
      const available = themeManager.getAvailableThemes().join(', ')
      const current = themeManager.getThemeName()
      ctx.addMessage({ type: 'assistant', text: `Current theme: ${current}\nAvailable: ${available}` })
      return
    }

    const success = themeManager.setTheme(name)
    if (success) {
      ctx.setThemeVersion((v: number) => v + 1)
      ctx.addMessage({ type: 'assistant', text: `Switched to ${name} theme.` })
    } else {
      const available = themeManager.getAvailableThemes().join(', ')
      ctx.addMessage({ type: 'error', text: `Unknown theme: ${name}. Available: ${available}` })
    }
  },
})
