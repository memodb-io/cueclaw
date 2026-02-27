import { ThemeProvider } from '@inkjs/ui'
import { cueclawTheme } from './theme.js'
import { KeypressProvider } from './use-keypress.js'
import { DialogManager } from './dialog-manager.js'
import { AppProvider } from './app-provider.js'
import { AppLayout } from './app-layout.js'

// Re-export for consumers
export type { ChatMessage } from './ui-state-context.js'

interface AppProps {
  cwd: string
  skipOnboarding?: boolean
}

export function App({ cwd, skipOnboarding }: AppProps) {
  return (
    <ThemeProvider theme={cueclawTheme}>
      <KeypressProvider>
        <DialogManager>
          <AppProvider cwd={cwd} skipOnboarding={skipOnboarding}>
            <AppLayout cwd={cwd} />
          </AppProvider>
        </DialogManager>
      </KeypressProvider>
    </ThemeProvider>
  )
}
