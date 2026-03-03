# cueclaw

## 0.2.1

### Patch Changes

- aaec9a2: Fix TUI bugs: stale closure in streaming text, out-of-bounds index crashes, TOCTOU race in daemon stop, missing error handling in cancel/cleanup paths, and stale config validation cache.

## 0.2.0

### Minor Changes

- 5bd904f: Change default model from claude-sonnet-4-6 to claude-opus-4-6

## 0.1.4

### Patch Changes

- 4368f00: Add CUECLAW_MODEL env override for OpenRouter, isolate env vars per agent step, broadcast to tracked active JIDs, persist plan rejection to DB, compute duration_ms on run completion, two-pass executor failure handling with ask_user retry, TUI workflow stop via abort controller, graceful container agent-runner shutdown, and stale session cleanup on daemon startup.

## 0.1.3

### Patch Changes

- 05c72ee: ### New Features

  - **Container**: GHCR image management with auto-pull (production) and auto-build (dev), container execution now opt-in
  - **Daemon**: PID file management and background daemon auto-spawn, CLI daemon commands reworked
  - **Channels**: `sendMessage` returns message ID, new `editMessage` for in-place status updates
  - **Planner**: Channel-aware system prompt via ChannelContext (bot vs TUI adapts prompt)
  - **TUI Theme System**: 3 built-in themes (dark/light/dracula) with runtime switching via `/theme` command

  ### Improvements

  - **Trigger Loop**: Reports workflow failure with step-level error details instead of always broadcasting success

  ### Refactors

  - **TUI Architecture**: Decomposed monolithic app.tsx into layered provider/context/hook/component architecture with 45+ extracted modules

## 0.1.2

### Patch Changes

- Fix 7 code issues: CLI version from package.json, daemon restart command, --detach flag, channel disconnect on shutdown, async poll trigger, Telegram setTyping guard, confirmation timeout notification. Sync all documentation with implementation.

## 0.1.1

### Patch Changes

- Fix FOREIGN KEY constraint error when confirming workflows via bot channels. Workflows are now persisted to the database before confirmation.

## 0.1.0

### Minor Changes

- Add chat intent classification and Telegram callback button support. Non-command messages are now classified via LLM to distinguish casual chat from workflow requests, and Telegram inline keyboard buttons (Confirm/Modify/Cancel) are properly wired.

## 0.0.4

### Patch Changes

- bc06eca: CI: release workflow now triggers only after CI passes via workflow_run

## 0.0.3

### Patch Changes

- 46110e3: Fix CI release pipeline: remove redundant GitHub Release step that conflicted with changesets built-in release creation

## 0.0.2

### Patch Changes

- 7052ebd: Add CI pipeline, changesets, commitlint, dependabot, and GitHub templates
