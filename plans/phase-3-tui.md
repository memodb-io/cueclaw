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

- [x] Install Ink v5 + React 18 + `@inkjs/ui`
- [x] Create `src/tui/app.tsx` as the Ink root component
- [x] Wire up `cueclaw tui` (and bare `cueclaw`) CLI command to render `<App />`
- [x] State management: decomposed into context providers + custom hooks (not `useReducer`)
- [x] View router: `AppLayout` switches between views based on `UIStateContext`
- [x] `ThemeProvider` wraps the entire App, providing unified semantic colors
- [x] `exitOnCtrlC: false` passed to Ink's `render()` — Ctrl+C handled by priority keypress system

**Decomposed architecture** — `app.tsx` is a ~30-line composition shell:

```typescript
// src/tui/app.tsx
App (cwd, skipOnboarding)
 └─ ThemeProvider (@inkjs/ui)
     └─ KeypressProvider        // Priority-based single-useInput dispatch
         └─ DialogManager       // Priority-queued modal dialogs (e.g., exit confirmation)
             └─ AppProvider     // All state + business logic (contexts: UIState, UIActions)
                 └─ AppLayout   // View routing reads from UIStateContext
```

**State & logic layers:**
- `AppProvider` (app-provider.tsx): owns all state (`useState`/`useRef`), composes custom hooks, provides `UIStateContext` + `UIActionsContext`
- Custom hooks in `tui/hooks/`: `use-daemon-bridge`, `use-planner-session`, `use-workflow-execution`, `use-global-keypress`, `use-command-dispatch`, `exit-helpers`
- Components read from context via `useUIState()` / `useUIActions()` — no prop drilling

### 3.2 Theme System (`src/tui/theme/`)

Full theme system with multiple built-in themes and live switching.

- [x] Raw color palette interface (`colors-theme.ts`): foreground, background, accents, border, gradients
- [x] Semantic color layer (`semantic-colors.ts`): `text.primary`, `status.error`, `border.focused`, etc.
- [x] Three built-in themes (`themes.ts`): dark (Catppuccin Mocha), light (Catppuccin Latte), dracula
- [x] Singleton theme manager (`theme-manager.ts`): `setTheme(name)`, `getSemanticColors()`, `getVersion()`
- [x] Lazy proxy (`index.ts`): always reflects current theme without re-import
- [x] Color utilities (`color-utils.ts`): `hexToRgb`, `rgbToHex`, `interpolateColor` for gradient blending
- [x] Live theme switching via `/theme [dark|light|dracula]` command
- [x] `@inkjs/ui` `extendTheme` still used for the `ThemeProvider` wrapper (`theme.ts`)

**Design decisions:**

- Uses hex colors for rich 256-color rendering (modern terminals)
- `interpolateColor` generates derived colors from theme palette
- `themeVersion` counter in `UIState` triggers re-renders on theme change
- Components access colors via the lazy `theme` proxy from `tui/theme/index.ts`

### 3.3 Title Header

The app displays a simple static title header (not a separate view or component):

- [x] `<Text color="cyan" bold>CueClaw</Text>` + version + working directory path
- [x] Rendered via Ink `<Static>` so it stays pinned at the top
- [x] Hidden during onboarding view

### 3.4 Chat View (decomposed)

`chat.tsx` is now a ~10-line layout shell composing `MainContent` + `Composer`:

- [x] `MainContent` (main-content.tsx): message list with scroll (Ctrl+P/Ctrl+N), streaming text display, `ThinkingIndicator`
- [x] `Composer` (composer.tsx): rounded-border input box, status bar (`[mode] | daemon`), command hints dropdown
- [x] `ThinkingIndicator` (thinking-indicator.tsx): animated spinner (`⠋⠙⠹...`) with elapsed seconds, gradient color cycling, Esc-to-cancel
- [x] `ResettableInput` (resettable-input.tsx): extracted input with reset + history navigation (up/down arrow via `use-input-history.ts`)
- [x] `Banner` (banner.tsx): ASCII art "CUECLAW" logo with per-line gradient coloring; compact fallback for narrow terminals
- [x] Per-type message components in `tui/messages/`: user, assistant, assistant-jsx, system, error, warning, plan-ready
- [x] `HalfLinePaddedBox` (half-line-padded-box.tsx): box with half-line color padding using `▀`/`▄` block characters
- [ ] ~~Support multi-line input~~ — NOT IMPLEMENTED (Enter always submits)

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

Workflow listing is handled inline in Chat via slash commands, with a dedicated Status view and Workflow Detail view:

- [x] `/list` (or `/ls`) renders `WorkflowTable` component inline in chat messages
- [x] `/status <id>` renders `WorkflowDetail` component inline in chat messages
- [x] `Ctrl+D` shortcut runs `/list` inline (does not switch views)
- [x] Color-coded phase indicators in table output
- [x] Workflow management commands: `/pause`, `/resume`, `/delete`
- [x] Status view (`status.tsx`) — standalone workflow list with select/stop/delete
- [x] Workflow Detail view (`workflow-detail-view.tsx`) — comprehensive overview when selecting a workflow from Status: header, trigger config, steps, recent runs, step results for latest run. Enter on a run drills into ExecutionView.

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

Actual views: `'onboarding' | 'chat' | 'plan' | 'execution' | 'status' | 'detail'`

| View | Entry | Exit |
|------|-------|------|
| **Onboarding** | First run (no config) | Completes setup → Chat |
| **Chat** | Default view after setup | — (central hub) |
| **Plan** | Auto-entered when Planner returns | `[Y]` → Execution, `[M]` → Chat, `[N]` → Chat |
| **Execution** | After confirming a plan, or drill-in from Detail | `Enter`/`Q`/`Esc` when complete → Chat (or back to Detail if entered from Detail) |
| **Status** | `/status` command | Back to Chat |
| **Detail** | Select workflow from Status (Enter) | `Q`/`Esc` → Status, `Enter` on run → Execution |

- [x] `Ctrl+D` runs `/list` inline in Chat (not a separate view)
- [x] `Ctrl+C` shows exit confirmation via `DialogManager` (no separate view — modals overlay current view)
- [x] Chat footer shows available hints and daemon status
- [x] `KeypressProvider` provides priority-based input handling — dialogs at `Critical` priority block underlying handlers
- [ ] ~~`Tab` cycles between Chat and Dashboard~~ — NOT IMPLEMENTED (no Dashboard view)
- [ ] ~~`Esc` goes back to previous view~~ — NOT IMPLEMENTED (individual views handle their own exit)

---

## Engineering Constraints

| Constraint | Approach |
|------------|----------|
| Terminal compatibility | Hex colors for 256-color terminals; graceful degradation |
| Theme system | `tui/theme/` directory — palette → semantic → manager → lazy proxy |
| Multiple themes | 3 built-in themes (dark, light, dracula) with live switching via `/theme` |
| Title header | ASCII art banner with gradient coloring via `banner.tsx` |
| Input handling | Single `useInput` in `KeypressProvider`, priority-based dispatch to handlers |
| Modals/Dialogs | `DialogManager` with priority queue, renders at `Critical` priority |
| State management | Context providers (`UIStateContext` + `UIActionsContext`) instead of prop drilling |

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
