import { extendTheme, defaultTheme } from '@inkjs/ui'

export const cueclawTheme = extendTheme(defaultTheme, {
  components: {
    Banner: {
      styles: {
        logo: () => ({ color: 'cyan' }),
        tagline: () => ({ color: 'gray', dimColor: true }),
      },
    },
    PlanView: {
      styles: {
        title: () => ({ color: 'cyan', bold: true }),
        stepPending: () => ({ color: 'gray' }),
        stepRunning: () => ({ color: 'yellow' }),
        stepDone: () => ({ color: 'green' }),
        stepFailed: () => ({ color: 'red' }),
        border: () => ({ borderColor: 'gray' }),
      },
    },
    StatusDashboard: {
      styles: {
        executing: () => ({ color: 'yellow' }),
        completed: () => ({ color: 'green' }),
        failed: () => ({ color: 'red' }),
        paused: () => ({ color: 'gray', dimColor: true }),
      },
    },
    Chat: {
      styles: {
        userMessage: () => ({ color: 'white', bold: true }),
        systemMessage: () => ({ color: 'cyan' }),
        prompt: () => ({ color: 'green' }),
      },
    },
  },
})
