import type { ColorsTheme } from './colors-theme.js'
import { interpolateColor } from '../color-utils.js'

export const darkTheme: ColorsTheme = {
  name: 'dark',
  type: 'dark',
  Foreground: '#CDD6F4',
  ForegroundDim: '#6C7086',
  Background: '#1E1E2E',
  AccentCyan: '#89DCEB',
  AccentGreen: '#A6E3A1',
  AccentYellow: '#F9E2AF',
  AccentRed: '#F38BA8',
  AccentBlue: '#89B4FA',
  AccentMagenta: '#CBA6F7',
  Border: interpolateColor('#1E1E2E', '#6C7086', 0.4),
  BorderAccent: '#89B4FA',
  Comment: '#6C7086',
  MessageBackground: interpolateColor('#1E1E2E', '#6C7086', 0.12),
  InputBackground: interpolateColor('#1E1E2E', '#6C7086', 0.08),
  GradientColors: ['#4796E4', '#847ACE', '#C3677F'],
}

export const lightTheme: ColorsTheme = {
  name: 'light',
  type: 'light',
  Foreground: '#4C4F69',
  ForegroundDim: '#9CA0B0',
  Background: '#EFF1F5',
  AccentCyan: '#04A5E5',
  AccentGreen: '#40A02B',
  AccentYellow: '#DF8E1D',
  AccentRed: '#D20F39',
  AccentBlue: '#1E66F5',
  AccentMagenta: '#8839EF',
  Border: interpolateColor('#EFF1F5', '#9CA0B0', 0.4),
  BorderAccent: '#1E66F5',
  Comment: '#9CA0B0',
  MessageBackground: interpolateColor('#EFF1F5', '#9CA0B0', 0.12),
  InputBackground: interpolateColor('#EFF1F5', '#9CA0B0', 0.08),
  GradientColors: ['#1E66F5', '#8839EF', '#D20F39'],
}

export const draculaTheme: ColorsTheme = {
  name: 'dracula',
  type: 'dark',
  Foreground: '#f8f8f2',
  ForegroundDim: '#6272a4',
  Background: '#282a36',
  AccentCyan: '#8be9fd',
  AccentGreen: '#50fa7b',
  AccentYellow: '#f1fa8c',
  AccentRed: '#ff5555',
  AccentBlue: '#6272a4',
  AccentMagenta: '#ff79c6',
  Border: interpolateColor('#282a36', '#6272a4', 0.4),
  BorderAccent: '#bd93f9',
  Comment: '#6272a4',
  MessageBackground: interpolateColor('#282a36', '#6272a4', 0.12),
  InputBackground: interpolateColor('#282a36', '#6272a4', 0.08),
  GradientColors: ['#bd93f9', '#ff79c6', '#ff5555'],
}

export const builtinThemes: Record<string, ColorsTheme> = {
  dark: darkTheme,
  light: lightTheme,
  dracula: draculaTheme,
}
