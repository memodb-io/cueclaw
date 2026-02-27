/**
 * Color interpolation utilities for theme background blending.
 */

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('')
}

/** Blend `overlay` onto `base` at given `opacity` (0–1). */
export function interpolateColor(base: string, overlay: string, opacity: number): string {
  const [br, bg, bb] = hexToRgb(base)
  const [or, og, ob] = hexToRgb(overlay)
  return rgbToHex(
    br + (or - br) * opacity,
    bg + (og - bg) * opacity,
    bb + (ob - bb) * opacity,
  )
}
