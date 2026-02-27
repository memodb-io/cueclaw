import { memo } from 'react'
import { Box, Text } from 'ink'
import { theme as colors } from './theme/index.js'
import { interpolateColor } from './color-utils.js'

// Full ASCII art — "CUECLAW" (~60 cols)
const LOGO = ` ██████╗██╗   ██╗███████╗ ██████╗██╗      █████╗ ██╗    ██╗
██╔════╝██║   ██║██╔════╝██╔════╝██║     ██╔══██╗██║    ██║
██║     ██║   ██║█████╗  ██║     ██║     ███████║██║ █╗ ██║
██║     ██║   ██║██╔══╝  ██║     ██║     ██╔══██║██║███╗██║
╚██████╗╚██████╔╝███████╗╚██████╗███████╗██║  ██║╚███╔███╔╝
 ╚═════╝ ╚═════╝ ╚══════╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ `

interface BannerProps {
  version: string
  cwd: string
  terminalWidth: number
}

export const Banner = memo(function Banner({ version, cwd, terminalWidth }: BannerProps) {
  const displayPath = cwd.replace(/^\/Users\/[^/]+/, '~')
  const gradient = colors.ui.gradient

  if (terminalWidth < 64) {
    // Compact: gradient-colored name text
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <GradientText text="CueClaw" colors={gradient} bold />
        <Text color={colors.ui.comment}>{version} · {displayPath}</Text>
      </Box>
    )
  }

  // Full: ASCII art with gradient coloring per line
  const lines = LOGO.split('\n')

  return (
    <Box flexDirection="column" paddingX={1} paddingTop={1}>
      {lines.map((line, i) => {
        const t = lines.length > 1 ? i / (lines.length - 1) : 0
        const color = lerpGradient(gradient, t)
        return <Text key={i} color={color}>{line}</Text>
      })}
      <Text color={colors.ui.comment}> {version} · {displayPath}</Text>
      <Text>{''}</Text>
    </Box>
  )
})

/** Render text with per-character gradient coloring. */
function GradientText({ text, colors: gradientColors, bold }: { text: string; colors: string[]; bold?: boolean }) {
  if (gradientColors.length === 0) return <Text bold={bold}>{text}</Text>

  const chars = [...text]
  return (
    <Text bold={bold}>
      {chars.map((ch, i) => {
        const t = chars.length > 1 ? i / (chars.length - 1) : 0
        return <Text key={i} color={lerpGradient(gradientColors, t)}>{ch}</Text>
      })}
    </Text>
  )
}

/** Linearly interpolate across a multi-stop gradient at position t (0–1). */
function lerpGradient(stops: string[], t: number): string {
  if (stops.length === 0) return '#ffffff'
  if (stops.length === 1) return stops[0]!
  const clamped = Math.max(0, Math.min(1, t))
  const segment = clamped * (stops.length - 1)
  const idx = Math.floor(segment)
  const frac = segment - idx
  const a = stops[Math.min(idx, stops.length - 1)]!
  const b = stops[Math.min(idx + 1, stops.length - 1)]!
  return interpolateColor(a, b, frac)
}
