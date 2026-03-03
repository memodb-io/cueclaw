import { describe, it, expect } from 'vitest'
import { stepStatusIcon, stepStatusColor, phaseColor, runStatusColor, formatDuration, formatTrigger } from './format-utils.js'
import { theme as colors } from './theme/index.js'

describe('stepStatusIcon', () => {
  it.each([
    ['succeeded', '✓'],
    ['running', '⊷'],
    ['failed', '✗'],
    ['skipped', '○'],
    ['pending', '○'],
  ] as const)('%s → %s', (status, expected) => {
    expect(stepStatusIcon(status)).toBe(expected)
  })
})

describe('stepStatusColor', () => {
  it.each([
    ['succeeded', colors.status.success],
    ['running', colors.status.warning],
    ['failed', colors.status.error],
    ['skipped', colors.status.muted],
    ['pending', colors.status.muted],
  ] as const)('%s → correct color', (status, expected) => {
    expect(stepStatusColor(status)).toBe(expected)
  })
})

describe('phaseColor', () => {
  it.each([
    ['executing', colors.status.warning],
    ['active', colors.status.success],
    ['completed', colors.status.success],
    ['failed', colors.status.error],
    ['paused', colors.status.muted],
    ['planning', colors.text.primary],
  ] as const)('%s → correct color', (phase, expected) => {
    expect(phaseColor(phase)).toBe(expected)
  })
})

describe('runStatusColor', () => {
  it.each([
    ['completed', colors.status.success],
    ['running', colors.status.warning],
    ['failed', colors.status.error],
    ['cancelled', colors.text.primary],
  ] as const)('%s → correct color', (status, expected) => {
    expect(runStatusColor(status as any)).toBe(expected)
  })
})

describe('formatDuration', () => {
  it('formats milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms')
  })

  it('formats seconds', () => {
    expect(formatDuration(3500)).toBe('4s')
  })

  it('formats minutes', () => {
    expect(formatDuration(90000)).toBe('2m')
  })

  it('boundary: 999ms stays in ms', () => {
    expect(formatDuration(999)).toBe('999ms')
  })

  it('boundary: 1000ms becomes seconds', () => {
    expect(formatDuration(1000)).toBe('1s')
  })

  it('boundary: 59999ms stays in seconds', () => {
    expect(formatDuration(59999)).toBe('60s')
  })

  it('boundary: 60000ms becomes minutes', () => {
    expect(formatDuration(60000)).toBe('1m')
  })
})

describe('formatTrigger', () => {
  it('formats poll trigger', () => {
    expect(formatTrigger({ type: 'poll', interval_seconds: 30, diff_mode: 'full' }))
      .toBe('poll every 30s (full)')
  })

  it('formats cron trigger without timezone', () => {
    expect(formatTrigger({ type: 'cron', expression: '0 * * * *' }))
      .toBe('cron: 0 * * * *')
  })

  it('formats cron trigger with timezone', () => {
    expect(formatTrigger({ type: 'cron', expression: '0 9 * * *', timezone: 'US/Eastern' }))
      .toBe('cron: 0 9 * * * (US/Eastern)')
  })

  it('formats manual trigger', () => {
    expect(formatTrigger({ type: 'manual' })).toBe('manual')
  })

  it('formats unknown trigger type', () => {
    expect(formatTrigger({ type: 'webhook' })).toBe('webhook')
  })
})
