import { useEffect } from 'react'
import { Box, Text } from 'ink'
import { useComponentTheme, type ComponentTheme } from '@inkjs/ui'

const LOGO = `  ██████╗██╗   ██╗███████╗ ██████╗██╗      █████╗ ██╗    ██╗
 ██╔════╝██║   ██║██╔════╝██╔════╝██║     ██╔══██╗██║    ██║
 ██║     ██║   ██║█████╗  ██║     ██║     ███████║██║ █╗ ██║
 ██║     ██║   ██║██╔══╝  ██║     ██║     ██╔══██║██║███╗██║
 ╚██████╗╚██████╔╝███████╗╚██████╗███████╗██║  ██║╚███╔███╔╝
  ╚═════╝ ╚═════╝ ╚══════╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝`

interface BannerProps {
  onComplete: () => void
}

export function Banner({ onComplete }: BannerProps) {
  const { styles } = useComponentTheme<ComponentTheme>('Banner')
  const logoStyle = styles?.logo?.() ?? { color: 'cyan' }
  const taglineStyle = styles?.tagline?.() ?? { color: 'gray', dimColor: true }

  useEffect(() => {
    const timer = setTimeout(onComplete, 1000)
    return () => clearTimeout(timer)
  }, [onComplete])

  return (
    <Box flexDirection="column" alignItems="center" marginTop={1}>
      <Text {...logoStyle}>{LOGO}</Text>
      <Text {...taglineStyle}>{'\n orchestrate your agents with natural language'}</Text>
    </Box>
  )
}
