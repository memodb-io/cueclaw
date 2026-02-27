import type { ColorsTheme } from './colors-theme.js'

export interface SemanticColors {
  text: {
    primary: string
    secondary: string
    accent: string
    user: string
    response: string
    link: string
  }
  status: {
    success: string
    warning: string
    error: string
    info: string
    muted: string
  }
  border: {
    default: string
    accent: string
    focused: string
  }
  background: {
    primary: string
    message: string
    input: string
  }
  ui: {
    comment: string
    gradient: string[]
  }
  prompt: string
}

export function buildSemanticColors(palette: ColorsTheme): SemanticColors {
  return {
    text: {
      primary: palette.Foreground,
      secondary: palette.ForegroundDim,
      accent: palette.AccentCyan,
      user: palette.Foreground,
      response: palette.Foreground,
      link: palette.AccentBlue,
    },
    status: {
      success: palette.AccentGreen,
      warning: palette.AccentYellow,
      error: palette.AccentRed,
      info: palette.AccentCyan,
      muted: palette.ForegroundDim,
    },
    border: {
      default: palette.Border,
      accent: palette.BorderAccent,
      focused: palette.AccentBlue,
    },
    background: {
      primary: palette.Background,
      message: palette.MessageBackground,
      input: palette.InputBackground,
    },
    ui: {
      comment: palette.Comment,
      gradient: palette.GradientColors,
    },
    prompt: palette.AccentGreen,
  }
}
