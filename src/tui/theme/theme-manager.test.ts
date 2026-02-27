import { describe, it, expect, beforeEach } from 'vitest'
import { themeManager } from './theme-manager.js'
import { theme } from './index.js'

beforeEach(() => {
  themeManager.setTheme('dark')
})

describe('themeManager', () => {
  it('defaults to dark theme', () => {
    expect(themeManager.getThemeName()).toBe('dark')
  })

  it('returns available themes', () => {
    const themes = themeManager.getAvailableThemes()
    expect(themes).toContain('dark')
    expect(themes).toContain('light')
    expect(themes).toContain('dracula')
  })

  it('switches to light theme', () => {
    const result = themeManager.setTheme('light')
    expect(result).toBe(true)
    expect(themeManager.getThemeName()).toBe('light')
    expect(themeManager.getSemanticColors().text.primary).toBe('#4C4F69')
  })

  it('switches to dracula theme', () => {
    themeManager.setTheme('dracula')
    expect(themeManager.getThemeName()).toBe('dracula')
    expect(themeManager.getSemanticColors().text.primary).toBe('#f8f8f2')
  })

  it('returns false for unknown theme', () => {
    const result = themeManager.setTheme('nonexistent')
    expect(result).toBe(false)
    expect(themeManager.getThemeName()).toBe('dark')
  })

  it('increments version on theme change', () => {
    const v1 = themeManager.getVersion()
    themeManager.setTheme('light')
    expect(themeManager.getVersion()).toBe(v1 + 1)
  })
})

describe('theme proxy', () => {
  it('reflects current theme colors', () => {
    expect(theme.text.primary).toBe('#CDD6F4')
    themeManager.setTheme('light')
    expect(theme.text.primary).toBe('#4C4F69')
  })

  it('updates all semantic tokens on switch', () => {
    themeManager.setTheme('dracula')
    expect(theme.status.error).toBe('#ff5555')
    expect(theme.border.accent).toBe('#bd93f9')
  })
})

describe('new semantic tokens', () => {
  it('has background tokens', () => {
    const colors = themeManager.getSemanticColors()
    expect(colors.background.primary).toBe('#1E1E2E')
    expect(colors.background.message).toMatch(/^#/)
    expect(colors.background.input).toMatch(/^#/)
  })

  it('has ui tokens', () => {
    const colors = themeManager.getSemanticColors()
    expect(colors.ui.comment).toBe('#6C7086')
    expect(colors.ui.gradient).toHaveLength(3)
  })

  it('has text.response and text.link', () => {
    const colors = themeManager.getSemanticColors()
    expect(colors.text.response).toBe('#CDD6F4')
    expect(colors.text.link).toBe('#89B4FA')
  })

  it('has border.focused', () => {
    const colors = themeManager.getSemanticColors()
    expect(colors.border.focused).toBe('#89B4FA')
  })

  it('light theme has background tokens', () => {
    themeManager.setTheme('light')
    const colors = themeManager.getSemanticColors()
    expect(colors.background.primary).toBe('#EFF1F5')
    expect(colors.ui.gradient).toHaveLength(3)
  })
})
