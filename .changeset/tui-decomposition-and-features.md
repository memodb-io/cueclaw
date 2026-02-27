---
"cueclaw": patch
---

### New Features
- **Container**: GHCR image management with auto-pull (production) and auto-build (dev), container execution now opt-in
- **Daemon**: PID file management and background daemon auto-spawn, CLI daemon commands reworked
- **Channels**: `sendMessage` returns message ID, new `editMessage` for in-place status updates
- **Planner**: Channel-aware system prompt via ChannelContext (bot vs TUI adapts prompt)
- **TUI Theme System**: 3 built-in themes (dark/light/dracula) with runtime switching via `/theme` command

### Improvements
- **Trigger Loop**: Reports workflow failure with step-level error details instead of always broadcasting success

### Refactors
- **TUI Architecture**: Decomposed monolithic app.tsx into layered provider/context/hook/component architecture with 45+ extracted modules
