import type { SemanticColors } from './semantic-colors.js'
import { themeManager } from './theme-manager.js'

export type { ColorsTheme } from './colors-theme.js'
export type { SemanticColors } from './semantic-colors.js'
export { themeManager } from './theme-manager.js'
export { builtinThemes } from './themes.js'

/** Lazy proxy — always reflects the current theme without re-import. */
export const theme: SemanticColors = new Proxy({} as SemanticColors, {
  get(_target, prop: string) {
    return (themeManager.getSemanticColors() as unknown as Record<string, unknown>)[prop]
  },
})
