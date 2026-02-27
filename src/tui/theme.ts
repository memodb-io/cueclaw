import { extendTheme, defaultTheme } from '@inkjs/ui'
import { theme } from './theme/index.js'

export const cueclawTheme = extendTheme(defaultTheme, {
  components: {
    Header: {
      styles: {
        hints: () => ({ color: theme.text.primary, dimColor: true }),
      },
    },
    PlanView: {
      styles: {
        title: () => ({ color: theme.border.accent, bold: true }),
        stepPending: () => ({ color: theme.status.muted }),
        stepRunning: () => ({ color: theme.status.warning }),
        stepDone: () => ({ color: theme.status.success }),
        stepFailed: () => ({ color: theme.status.error }),
        border: () => ({ borderColor: theme.border.default }),
      },
    },
    StatusDashboard: {
      styles: {
        executing: () => ({ color: theme.status.warning }),
        completed: () => ({ color: theme.status.success }),
        failed: () => ({ color: theme.status.error }),
        paused: () => ({ color: theme.status.muted, dimColor: true }),
      },
    },
    Chat: {
      styles: {
        userMessage: () => ({ color: theme.text.user, bold: true }),
        systemMessage: () => ({ color: theme.status.info }),
        assistantMessage: () => ({ color: theme.text.primary }),
        prompt: () => ({ color: theme.prompt }),
      },
    },
  },
})
