import type { SemanticColors } from './semantic-colors.js'
import { buildSemanticColors } from './semantic-colors.js'
import { builtinThemes, darkTheme } from './themes.js'

let currentSemanticColors: SemanticColors = buildSemanticColors(darkTheme)
let currentThemeName = 'dark'
let version = 0

export const themeManager = {
  getSemanticColors(): SemanticColors {
    return currentSemanticColors
  },

  getThemeName(): string {
    return currentThemeName
  },

  getVersion(): number {
    return version
  },

  setTheme(name: string): boolean {
    const palette = builtinThemes[name]
    if (!palette) return false
    currentSemanticColors = buildSemanticColors(palette)
    currentThemeName = name
    version++
    return true
  },

  getAvailableThemes(): string[] {
    return Object.keys(builtinThemes)
  },
}
