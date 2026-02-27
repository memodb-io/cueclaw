import { describe, it, expect } from 'vitest'
import { hexToRgb, rgbToHex, interpolateColor } from './color-utils.js'

describe('hexToRgb', () => {
  it('parses hex color', () => {
    expect(hexToRgb('#1E1E2E')).toEqual([30, 30, 46])
  })

  it('parses without hash', () => {
    expect(hexToRgb('FF0000')).toEqual([255, 0, 0])
  })
})

describe('rgbToHex', () => {
  it('converts rgb to hex', () => {
    expect(rgbToHex(30, 30, 46)).toBe('#1e1e2e')
  })

  it('pads single digit values', () => {
    expect(rgbToHex(0, 0, 0)).toBe('#000000')
  })
})

describe('interpolateColor', () => {
  it('returns base at opacity 0', () => {
    expect(interpolateColor('#000000', '#ffffff', 0)).toBe('#000000')
  })

  it('returns overlay at opacity 1', () => {
    expect(interpolateColor('#000000', '#ffffff', 1)).toBe('#ffffff')
  })

  it('blends at 50%', () => {
    expect(interpolateColor('#000000', '#ffffff', 0.5)).toBe('#808080')
  })

  it('blends dark background with dim overlay at 12%', () => {
    const result = interpolateColor('#1E1E2E', '#6C7086', 0.12)
    // Should be slightly lighter than base
    const [r, g, b] = hexToRgb(result)
    expect(r).toBeGreaterThan(30)
    expect(b).toBeGreaterThan(46)
  })
})
