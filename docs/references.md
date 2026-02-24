# Reference Source Code Index

## NanoClaw ([github.com/qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw))

| Module | File | Description |
|--------|------|-------------|
| **Channel Interface** | [`src/types.ts#L81-L105`](https://github.com/qwibitai/nanoclaw/blob/main/src/types.ts) | `Channel`, `OnInboundMessage`, `OnChatMetadata` interfaces |
| **WhatsApp Channel** | [`src/channels/whatsapp.ts`](https://github.com/qwibitai/nanoclaw/blob/main/src/channels/whatsapp.ts) | Baileys init, auth state, message send/receive, group metadata sync |
| **Telegram Channel** | [`.claude/skills/add-telegram/add/src/channels/telegram.ts`](https://github.com/qwibitai/nanoclaw/blob/main/.claude/skills/add-telegram/add/src/channels/telegram.ts) | grammy init, polling, message chunking, typing indicator |
| **Discord Channel** | [`.claude/skills/add-discord/add/src/channels/discord.ts`](https://github.com/qwibitai/nanoclaw/blob/main/.claude/skills/add-discord/add/src/channels/discord.ts) | discord.js, message chunking, attachment handling |
| **Agent SDK query()** | [`container/agent-runner/src/index.ts`](https://github.com/qwibitai/nanoclaw/blob/main/container/agent-runner/src/index.ts) | `query()` call, MessageStream pattern, session resume, hooks |
| **Container Spawn** | [`src/container-runner.ts`](https://github.com/qwibitai/nanoclaw/blob/main/src/container-runner.ts) | Docker spawn, stdin/stdout protocol, mount strategy, timeout management |
| **Concurrency Control** | [`src/group-queue.ts`](https://github.com/qwibitai/nanoclaw/blob/main/src/group-queue.ts) | GroupQueue, global concurrency cap, per-group queue, exponential backoff, graceful shutdown |
| **IPC (Host-side)** | [`src/ipc.ts`](https://github.com/qwibitai/nanoclaw/blob/main/src/ipc.ts) | File-polling IPC watcher, message/task authorization checks |
| **IPC (Container MCP)** | [`container/agent-runner/src/ipc-mcp-stdio.ts`](https://github.com/qwibitai/nanoclaw/blob/main/container/agent-runner/src/ipc-mcp-stdio.ts) | MCP server tools: send_message, schedule_task, list_tasks |
| **Scheduler** | [`src/task-scheduler.ts`](https://github.com/qwibitai/nanoclaw/blob/main/src/task-scheduler.ts) | Scheduled task polling, cron parsing, task execution |
| **Message Router** | [`src/index.ts`](https://github.com/qwibitai/nanoclaw/blob/main/src/index.ts) | Main orchestrator: Channel registration, OnInboundMessage dispatch, session mgmt |
| **SQLite** | [`src/db.ts`](https://github.com/qwibitai/nanoclaw/blob/main/src/db.ts) | better-sqlite3 init, migrations, CRUD |
| **Logging** | [`src/logger.ts`](https://github.com/qwibitai/nanoclaw/blob/main/src/logger.ts) | pino configuration |
| **Skills Engine** | [`skills-engine/`](https://github.com/qwibitai/nanoclaw/tree/main/skills-engine) | Three-way merge, conflict resolution, state tracking |
| **Config** | [`src/config.ts`](https://github.com/qwibitai/nanoclaw/blob/main/src/config.ts) | Paths, constants, env vars |

## Other References

| Module | Link | Description |
|--------|------|-------------|
| **TUI ASCII Art** | [GitHub Blog: Copilot CLI ASCII Banner](https://github.blog/engineering/from-pixels-to-characters-the-engineering-behind-github-copilot-clis-animated-ascii-banner/) | Frame-based architecture, semantic colors, Ink bypass strategy |
| **Workflow Protocol** | [Argo Workflows](https://github.com/argoproj/argo-workflows), [n8n](https://github.com/n8n-io/n8n), [LangGraph](https://github.com/langchain-ai/langgraph) | DAG dependencies, position layout, lifecycle state machine |
