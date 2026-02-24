# Phase 3: TUI Interface

> **Goal:** Build an interactive terminal UI using Ink (React for CLI) that provides a conversational interface for creating, confirming, and monitoring workflows.
>
> **Prerequisites:** Phase 0 (scaffolding) + Phase 1 (Planner, Executor, Agent Runner)

---

## What Gets Built

By the end of Phase 3, running `cueclaw` (or `cueclaw tui`) launches a full interactive terminal experience:

1. ASCII banner animation on startup
2. Chat interface to describe workflows in natural language
3. Plan view showing generated steps with confirm/modify/cancel
4. Live execution progress display
5. Dashboard to view all workflows

---

## What Already Exists (from Phase 0–1)

- CLI with registered subcommands (Phase 0)
- Config loading, SQLite, logger, types (Phase 0)
- Planner: natural language → Workflow JSON (Phase 1)
- Executor: runs steps via Agent Runner (Phase 1)
- Session management (Phase 1)

The TUI wraps these existing modules in a visual, interactive experience.

---

## Tasks

### 3.1 Ink Framework Setup

- [ ] Install Ink v5 + React 18 + `@inkjs/ui`
- [ ] Create `src/tui/app.tsx` as the Ink root component
- [ ] Wire up `cueclaw tui` (and bare `cueclaw`) CLI command to render `<App />`
- [ ] State management: `useReducer` for global app state (current view, active workflow, messages)
- [ ] View router: switch between Chat, Plan, Dashboard, and Execution views
- [ ] `ThemeProvider` wraps the entire App, providing unified semantic colors

```typescript
// src/tui/app.tsx — skeleton
import React, { useReducer } from 'react'
import { Box } from 'ink'
import { ThemeProvider } from '@inkjs/ui'
import { cueclawTheme } from './theme.js'
import { Banner } from './banner.js'
import { Chat } from './chat.js'
import { PlanView } from './plan-view.js'
import { Status } from './status.js'

type View = 'banner' | 'chat' | 'plan' | 'dashboard' | 'execution'

export function App() {
  const [state, dispatch] = useReducer(appReducer, initialState)

  return (
    <ThemeProvider theme={cueclawTheme}>
      <Box flexDirection="column" height="100%">
        {state.view === 'banner' && <Banner onComplete={() => dispatch({ type: 'SHOW_CHAT' })} />}
        {state.view === 'chat' && <Chat onPlanGenerated={(wf) => dispatch({ type: 'SHOW_PLAN', workflow: wf })} />}
        {state.view === 'plan' && <PlanView workflow={state.workflow} onConfirm={...} onModify={...} onCancel={...} />}
        {state.view === 'dashboard' && <Status workflows={state.workflows} />}
        {state.view === 'execution' && <ExecutionView run={state.activeRun} />}
      </Box>
    </ThemeProvider>
  )
}
```

### 3.2 Theme System (`src/tui/theme.ts`)

Uses `@inkjs/ui`'s `extendTheme` to define the CueClaw theme. Components consume colors via the `useComponentTheme()` hook.

- [ ] Define CueClaw semantic colors (based on ANSI color names, terminal auto-adapts to dark/light)
- [ ] Define theme styles for each custom component
- [ ] Components use `useComponentTheme()` for colors — no hardcoded color values

```typescript
// src/tui/theme.ts
import { extendTheme, defaultTheme } from '@inkjs/ui'

export const cueclawTheme = extendTheme(defaultTheme, {
  components: {
    // Banner
    Banner: {
      styles: {
        logo: () => ({ color: 'cyan' }),
        tagline: () => ({ color: 'gray', dimColor: true }),
      },
    },
    // Plan view
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
    // Status dashboard
    StatusDashboard: {
      styles: {
        executing: () => ({ color: 'yellow' }),
        completed: () => ({ color: 'green' }),
        failed: () => ({ color: 'red' }),
        paused: () => ({ color: 'gray', dimColor: true }),
      },
    },
    // Chat
    Chat: {
      styles: {
        userMessage: () => ({ color: 'white', bold: true }),
        systemMessage: () => ({ color: 'cyan' }),
        prompt: () => ({ color: 'green' }),
      },
    },
  },
})
```

**Usage in components:**

```typescript
// src/tui/plan-view.tsx
import { useComponentTheme } from '@inkjs/ui'

// PlanStep is a definition type (no runtime status field).
// Runtime status comes from StepRun, passed separately as a prop.
function StepLine({ step, status }: { step: PlanStep; status?: StepStatus }) {
  const { styles } = useComponentTheme<PlanViewTheme>('PlanView')

  const statusStyle = {
    pending: styles.stepPending,
    running: styles.stepRunning,
    succeeded: styles.stepDone,
    failed: styles.stepFailed,
  }[status ?? 'pending'] ?? styles.stepPending

  return <Text {...statusStyle()}>{step.description}</Text>
}
```

**Design decisions:**

- Use only ANSI color names (`cyan`, `green`, `red`, `yellow`, `gray`) — terminal auto-adapts to dark/light mode
- No hex/rgb — ensures 16-color terminal compatibility
- Future: `config.yaml`'s `ui.theme` field can support custom themes, overriding `cueclawTheme`

### 3.3 ASCII Banner (`src/tui/banner.tsx`)

MVP uses a static ASCII banner — no frame animation (animation can be a future enhancement).

```
  ██████╗██╗   ██╗███████╗ ██████╗██╗      █████╗ ██╗    ██╗
 ██╔════╝██║   ██║██╔════╝██╔════╝██║     ██╔══██╗██║    ██║
 ██║     ██║   ██║█████╗  ██║     ██║     ███████║██║ █╗ ██║
 ██║     ██║   ██║██╔══╝  ██║     ██║     ██╔══██║██║███╗██║
 ╚██████╗╚██████╔╝███████╗╚██████╗███████╗██║  ██║╚███╔███╔╝
  ╚═════╝ ╚═════╝ ╚══════╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝

 orchestrate your agents with natural language
```

- [ ] Static ASCII art + tagline, rendered with Ink `<Text>` component
- [ ] Use `useComponentTheme('Banner')` for colors — no hardcoded values
- [ ] Show for ~1s then auto-transition to Chat view (or `--no-banner` to skip)
- [ ] Non-blocking: initialization proceeds in parallel

### 3.4 Chat View (`src/tui/chat.tsx`)

- [ ] Scrollable message history (user messages + CueClaw responses)
- [ ] Text input at the bottom with prompt indicator (`> `)
- [ ] On submit: send user text to Planner, show "Generating plan..." spinner
- [ ] When Planner returns: auto-switch to Plan view
- [ ] Support multi-line input (Shift+Enter for newline, Enter to submit)
- [ ] Message formatting: user messages vs. system messages with distinct styling

```
You: Create a workflow that monitors GitHub issues assigned to me
     and automatically creates a branch and draft PR.

CueClaw: Generating execution plan...
```

### 3.5 Plan View (`src/tui/plan-view.tsx`)

- [ ] Display workflow name, trigger config, and step list
- [ ] Each step shows: index, description, dependencies, status indicator
- [ ] Three action buttons: `[Y] Confirm`, `[M] Modify`, `[N] Cancel`
- [ ] Confirm → calls `confirmPlan()` from Phase 1 → transitions to execution
- [ ] Modify → prompts for modification text → calls `modifyPlan()` → re-renders updated plan
- [ ] Cancel → discards workflow → returns to Chat view
- [ ] Highlight dependencies visually (indent or connecting lines)

```
┌─ Plan: GitHub Issue Auto PR ───────────────────┐
│ Trigger: poll (60s, gh api ...)                │
│                                                │
│ 1. [ ] Clone repo and create branch from dev   │
│ 2. [ ] Analyze issue and generate plan         │
│    └─ depends on: step 1                       │
│ 3. [ ] Commit plan and create Draft PR         │
│    └─ depends on: step 2                       │
│ 4. [ ] Notify user                             │
│    └─ depends on: step 3                       │
│                                                │
│ Failure policy: stop on failure                │
│                                                │
│ [Y] Confirm  [M] Modify  [N] Cancel            │
└────────────────────────────────────────────────┘
```

### 3.6 Workflow List / Dashboard (`src/tui/status.tsx`)

- [ ] Table view of all workflows: ID, name, phase, last run status, next trigger
- [ ] Select a workflow to view execution details
- [ ] Keyboard navigation: arrow keys to select, Enter to view details
- [ ] `Ctrl+D` shortcut from any view to jump to Dashboard
- [ ] Color-coded status: green=completed, yellow=running, red=failed, gray=paused

```
┌─ Workflows ──────────────────────────────────────────────────┐
│ ID          Name                    Phase       Last Run     │
│ wf_abc123   Issue Auto PR           executing   2m ago ●     │
│ wf_def456   PR Review Loop          paused      1h ago ◌     │
│ wf_ghi789   Daily Report            completed   today ✓      │
│                                                              │
│ [Enter] View  [P] Pause  [R] Resume  [D] Delete  [Q] Back    │
└──────────────────────────────────────────────────────────────┘
```

### 3.7 Execution Progress View

- [ ] Real-time step progress: checkmark for completed, spinner for running, dash for pending
- [ ] Duration display for each completed step
- [ ] Live output stream from the agent (streamed from `onProgress` callback)
- [ ] Auto-scroll to latest output
- [ ] `Ctrl+C` to cancel running execution

```
Workflow: GitHub Issue Auto PR          Status: Running
Trigger: Issue #42 assigned             Started: 2m ago

Steps:
✓ 1. Clone repo and create branch      (12s)
● 2. Analyze issue and generate plan    (running 45s)
  3. Commit plan and create Draft PR    (pending)
  4. Notify user                        (pending)

── Live Output ──────────────────────────────────
[agent] Reading src/auth/...
[agent] Analyzing login flow requirements...
─────────────────────────────────────────────────
```

### 3.8 TUI Channel Implementation (`src/channels/tui.ts`)

- [ ] Implement the `Channel` interface for local TUI usage
- [ ] `jid` is fixed to `"local"` for all TUI interactions
- [ ] `sendMessage` pushes messages to the TUI message display
- [ ] `connect()` is a no-op (always connected)
- [ ] Bridge between TUI input events and `OnInboundMessage` callback
- [ ] TUI Chat should route user input through `MessageRouter.handleInbound('tui', 'local', message)` for consistency with Bot channels

### 3.9 View Navigation

| View | Entry | Shortcut |
|------|-------|----------|
| **Chat** | Default view on startup | `Esc` from Plan view |
| **Plan** | Auto-entered when Planner returns | — |
| **Dashboard** | From Chat view | `Ctrl+D` |
| **Execution** | Select from Dashboard | `Enter` on a workflow |

- [ ] `Tab` cycles between Chat and Dashboard
- [ ] `Esc` goes back to previous view
- [ ] Status bar at bottom shows current view + available shortcuts

---

## Engineering Constraints

| Constraint | Approach |
|------------|----------|
| Terminal compatibility | ANSI color names (16-color), terminal auto-adapts to dark/light mode |
| Theme system | `@inkjs/ui` ThemeProvider + `extendTheme` + `useComponentTheme` |
| No hex/rgb | Ensures 16-color terminal compatibility; dark/light handled by terminal |
| Banner | Static ASCII art, `--no-banner` flag to skip |
| Future custom themes | `config.yaml`'s `ui.theme` field can override the default theme |

---

## Acceptance Criteria

- [ ] `cueclaw` launches TUI with ASCII banner
- [ ] Banner displays briefly and transitions to Chat view
- [ ] Typing a workflow description and pressing Enter triggers Planner
- [ ] Generated plan displays correctly in Plan view
- [ ] `[Y]` confirms and starts execution; `[M]` prompts for modifications; `[N]` cancels
- [ ] Execution progress shows real-time step status updates
- [ ] Dashboard lists all workflows with correct status
- [ ] `Ctrl+D` navigates to Dashboard from Chat
- [ ] `--no-banner` flag skips banner
- [ ] TUI Channel correctly implements Channel interface

---

## Dependencies to Install

```bash
pnpm add ink @inkjs/ui ink-text-input ink-spinner react
pnpm add -D @types/react
```

---

## What This Unlocks

Phase 3 provides the primary local interaction interface:
- **Phase 4** Bot Channels replicate the same UX flow (Chat → Plan → Confirm → Execute) on messaging platforms
- **Phase 6** uses TUI as one of two validation entry points (TUI + Bot)
