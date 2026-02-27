# Phase 3: TUI Interface

> **Goal:** Build an interactive terminal UI using Ink (React for CLI) that provides a conversational interface for creating, confirming, and monitoring workflows.
>
> **Prerequisites:** Phase 0 (scaffolding) + Phase 1 (Planner, Executor, Agent Runner)

---

## What Gets Built

By the end of Phase 3, running `cueclaw` (or `cueclaw tui`) launches a full interactive terminal experience:

1. Title header with version and path on startup
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
import { Chat } from './chat.js'
import { PlanView } from './plan-view.js'
import { Status } from './status.js'

type View = 'onboarding' | 'chat' | 'plan' | 'dashboard' | 'execution'

export function App() {
  const [state, dispatch] = useReducer(appReducer, initialState)

  return (
    <ThemeProvider theme={cueclawTheme}>
      <Box flexDirection="column" height="100%">
        {/* Static title header: "CueClaw" + version + path */}
        <Static items={state.view !== 'onboarding' ? ['banner'] : []}>
          {(item) => (
            <Box key={item} flexDirection="column" paddingX={1} paddingY={1}>
              <Text color="cyan" bold>CueClaw</Text>
              <Text dimColor>{versionLabel} · {displayPath}</Text>
            </Box>
          )}
        </Static>
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

### 3.3 Title Header

The app displays a simple static title header (not a separate view or component):

- [x] `<Text color="cyan" bold>CueClaw</Text>` + version + working directory path
- [x] Rendered via Ink `<Static>` so it stays pinned at the top
- [x] Hidden during onboarding view

### 3.4 Chat View (`src/tui/chat.tsx`)

- [x] Message history (user messages + CueClaw responses) — no scroll management (Ink limitation)
- [x] Text input at the bottom with prompt indicator (`> `)
- [x] On submit: send user text to Planner, show "Thinking..." spinner
- [x] When Planner returns: auto-switch to Plan view
- [ ] ~~Support multi-line input~~ — NOT IMPLEMENTED (Enter always submits)
- [x] Message formatting: user, system, and assistant messages with distinct styling

```
You: Create a workflow that monitors GitHub issues assigned to me
     and automatically creates a branch and draft PR.

CueClaw: Generating execution plan...
```

### 3.5 Plan View (`src/tui/plan-view.tsx`)

- [x] Display workflow name, trigger config, and step list
- [x] Each step shows: index, description, dependencies, status indicator
- [x] Three action buttons: `[Y] Confirm`, `[M] Modify`, `[N] Cancel`
- [x] Confirm → calls `confirmPlan()` (pure transformation) → persists to DB → transitions to execution or active
- [x] Modify → returns to Chat view with "Describe your modifications:" prompt → re-plans via PlannerSession
- [x] Cancel → discards workflow → returns to Chat view
- [x] Highlight dependencies visually (`└─ depends on:` lines)

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

### 3.6 Workflow List / Dashboard

No standalone Dashboard view exists. Workflow listing is handled inline in Chat via slash commands:

- [x] `/list` (or `/ls`) renders `WorkflowTable` component inline in chat messages
- [x] `/status <id>` renders `WorkflowDetail` component inline in chat messages
- [x] `Ctrl+D` shortcut runs `/list` inline (does not switch views)
- [x] Color-coded phase indicators in table output
- [x] Workflow management commands: `/pause`, `/resume`, `/delete`

**Note:** `src/tui/status.tsx` exists as a standalone component but is not wired into app view navigation. The inline slash command approach was chosen for simplicity and consistency with Bot channel interaction patterns.

```
> /list

 ID           Name              Phase       Trigger
 wf_abc123    Issue Auto PR     active      poll (60s)
 wf_def456    PR Review Loop    paused      poll (60s)
 wf_ghi789    Daily Report      completed   cron (0 9 * * *)
```

### 3.7 Execution Progress View (`src/tui/execution-view.tsx`)

- [x] Real-time step progress with icons: `✓` (succeeded), `●` (running), `✗` (failed), `○` (skipped)
- [x] Spinner displayed for running steps
- [x] Duration display for each completed step
- [x] Live output display (last 10 lines from output prop)
- [x] `X` to abort/cancel while running; `Enter`/`Q`/`Esc` to return when complete
- [ ] ~~Auto-scroll to latest output~~ — NOT IMPLEMENTED (Ink limitation)

```
Workflow: GitHub Issue Auto PR          Status: Running

Steps:
✓ 1. Clone repo and create branch      (12s)
● 2. Analyze issue and generate plan    (running 45s)
  3. Commit plan and create Draft PR    (pending)
  4. Notify user                        (pending)

[X] Abort
```

### 3.8 TUI Channel Implementation (`src/channels/tui.ts`)

- [x] Implement the `Channel` interface for local TUI usage
- [x] `jid` is fixed to `"local"` for all TUI interactions
- [x] `sendMessage` calls internal `sendFn` callback to push messages to TUI
- [x] `connect()` is a no-op (always connected)
- [x] `sendConfirmation()` sends text message indicating plan is ready
- [ ] ~~TUI Chat routes through `MessageRouter.handleInbound()`~~ — NOT IMPLEMENTED (TUI input handled directly in `app.tsx`'s `handleChatSubmit`, not routed through MessageRouter like Bot channels)

### 3.9 View Navigation

Actual views: `'onboarding' | 'chat' | 'plan' | 'execution' | 'exit_prompt'`

| View | Entry | Exit |
|------|-------|------|
| **Onboarding** | First run (no config) | Completes setup → Chat |
| **Chat** | Default view after setup | — (central hub) |
| **Plan** | Auto-entered when Planner returns | `[Y]` → Execution, `[M]` → Chat, `[N]` → Chat |
| **Execution** | After confirming a plan | `Enter`/`Q`/`Esc` when complete → Chat |
| **Exit Prompt** | `Ctrl+C` from any view | Service install or quit |

- [x] `Ctrl+D` runs `/list` inline in Chat (not a separate view)
- [x] `Ctrl+C` shows exit prompt with daemon service install option
- [x] Chat footer shows available hints and daemon status
- [ ] ~~`Tab` cycles between Chat and Dashboard~~ — NOT IMPLEMENTED (no Dashboard view)
- [ ] ~~`Esc` goes back to previous view~~ — NOT IMPLEMENTED (individual views handle their own exit)

---

## Engineering Constraints

| Constraint | Approach |
|------------|----------|
| Terminal compatibility | ANSI color names (16-color), terminal auto-adapts to dark/light mode |
| Theme system | `@inkjs/ui` ThemeProvider + `extendTheme` + `useComponentTheme` |
| No hex/rgb | Ensures 16-color terminal compatibility; dark/light handled by terminal |
| Title header | Simple `<Text>` with version + path, pinned via `<Static>` |
| Future custom themes | `config.yaml`'s `ui.theme` field can override the default theme |

---

## Acceptance Criteria

- [x] `cueclaw` launches TUI with title header (CueClaw + version + path)
- [x] Typing a workflow description and pressing Enter triggers Planner (multi-turn via PlannerSession)
- [x] Generated plan displays correctly in Plan view
- [x] `[Y]` confirms and starts execution; `[M]` returns to chat for modifications; `[N]` cancels
- [x] Execution progress shows real-time step status updates
- [x] `/list` and `/status` commands show workflow information inline in Chat
- [x] `Ctrl+D` runs `/list` inline in Chat
- [x] TUI Channel implements Channel interface (input not routed through MessageRouter)

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
