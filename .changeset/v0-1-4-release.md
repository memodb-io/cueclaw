---
"cueclaw": patch
---

Add CUECLAW_MODEL env override for OpenRouter, isolate env vars per agent step, broadcast to tracked active JIDs, persist plan rejection to DB, compute duration_ms on run completion, two-pass executor failure handling with ask_user retry, TUI workflow stop via abort controller, graceful container agent-runner shutdown, and stale session cleanup on daemon startup.
