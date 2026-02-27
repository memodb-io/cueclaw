# Configuration

## Config File

```yaml
# ~/.cueclaw/config.yaml (global) or .cueclaw/config.yaml (project-level)

claude:
  api_key: ${ANTHROPIC_API_KEY}
  base_url: https://api.anthropic.com  # Custom API endpoint (OpenRouter, etc.)
  planner:
    model: claude-sonnet-4-6
  executor:
    model: claude-sonnet-4-6
    # api_key: ${EXECUTOR_API_KEY}     # Optional: override global API key for executor
    # base_url: https://custom.api.com # Optional: override global base URL for executor
    # skip_permissions: false          # Optional: skip Claude Code permission checks

identity:
  name: tiangeng

whatsapp:
  enabled: true
  auth_dir: ~/.cueclaw/auth/whatsapp
  allowed_jids: []                   # Empty = allow all; set to restrict access
    # - "1234567890@s.whatsapp.net"

telegram:
  enabled: true
  token: ${TELEGRAM_BOT_TOKEN}
  allowed_users:
    - "your_telegram_id"

logging:
  level: info
  dir: ~/.cueclaw/logs

container:
  enabled: true                    # false = local execution with PreToolUse hooks only
  image: cueclaw-agent:latest
  timeout: 1800000                 # 30 min hard timeout per step
  max_output_size: 10485760        # 10MB output cap
  idle_timeout: 1800000            # 30 min idle timeout
  network: none                    # 'none' | 'host' | 'bridge'
    # none: no network (most secure, default)
    # bridge: workflows needing external API calls (e.g., gh, curl) — recommended for most workflows
    # host: full host network access (least secure)
    # Note: most workflows need network access (GitHub API, curl, etc.) — set to 'bridge' for those
```

**Config priority** (low → high): `~/.cueclaw/config.yaml` → `./.cueclaw/config.yaml` → env vars → CLI args

`${ENV_VAR}` interpolation is supported in YAML values.

### Third-Party API Proxies (OpenRouter, etc.)

CueClaw supports third-party API proxies by setting `claude.base_url`:

```yaml
claude:
  api_key: sk-or-v1-xxxx          # Provider-specific API key
  base_url: https://openrouter.ai/api/v1
```

The client factory (`createAnthropicClient`) automatically detects non-official base URLs and uses `authToken` instead of `apiKey` for authentication, which is required for compatibility with most proxy services.

Executor-specific overrides allow using a different provider for execution vs planning:

```yaml
claude:
  api_key: sk-or-v1-xxxx          # Planner uses OpenRouter
  base_url: https://openrouter.ai/api/v1
  executor:
    api_key: sk-ant-xxxx           # Executor uses official Anthropic API
    base_url: https://api.anthropic.com
```

## CLI Commands

```bash
cueclaw new                     # Interactive workflow creation (enter TUI)
cueclaw list                    # List all workflows
cueclaw status [workflow-id]    # View workflow status
cueclaw pause <workflow-id>     # Pause workflow
cueclaw resume <workflow-id>    # Resume workflow
cueclaw delete <workflow-id>    # Delete workflow

cueclaw daemon start [--detach]  # Start daemon (foreground or background)
cueclaw daemon stop              # Gracefully stop daemon
cueclaw daemon restart           # Stop + start
cueclaw daemon install           # Register OS system service (launchd/systemd)
cueclaw daemon uninstall         # Remove OS system service
cueclaw daemon status            # View service status
cueclaw daemon logs              # View logs (tail -f)

cueclaw info                    # Show current config, SDK version, etc.

cueclaw bot start               # Start all configured Bot Channels
cueclaw bot status              # View Channel connection status
cueclaw bot config              # Configure Bot (WhatsApp auth / Telegram token)

cueclaw tui                     # Start interactive TUI (default command)
cueclaw                         # Equivalent to cueclaw tui

cueclaw config                  # Edit config
cueclaw config get <key>        # Get config value
cueclaw config set <key> <val>  # Set config value
```

## TUI Slash Commands

When inside the TUI chat, the following slash commands are available:

```
/help (/h, /?)         Show available commands
/list (/ls)            List all workflows
/status (/st) [id]     View workflow status (or list all if no ID)
/pause <id>            Pause an active workflow
/resume <id>           Resume a paused workflow
/delete (/rm) <id>     Delete a workflow (cannot delete while executing)
/config (/cfg)         View or set configuration
                       /config get [key]       — Get config value (dotted key, e.g. claude.planner.model)
                       /config set <key> <val> — Set config value
/daemon                View daemon status (status|start|stop)
/bot                   Manage bot channels (start|status)
/info                  Show system information (version, models, channels)
/clear (/cls)          Clear chat messages
/new <description>     Generate a plan directly (skip multi-turn conversation)
/cancel                Cancel current planner conversation
/setup                 Re-run configuration setup wizard
```

Commands support prefix matching for workflow IDs (e.g., `/status wf_abc` matches `wf_abcdef123`).

## Environment Variables

### `.env` file

CueClaw loads `.env` from the working directory on startup. Values are injected into `process.env` without overwriting existing variables. This means shell-level env vars always take priority over `.env` values.

In dev mode, the onboarding wizard and `set_secret` planner tool write secrets to `.env` via `writeEnvVar()`. In production, secrets are stored in `config.yaml`.

### Supported Environment Variables

| Variable | Effect |
|----------|--------|
| `ANTHROPIC_API_KEY` | Overrides `claude.api_key` in config |
| `ANTHROPIC_BASE_URL` | Overrides `claude.base_url` in config |
| `TELEGRAM_BOT_TOKEN` | Sets `telegram.token` and auto-enables Telegram channel |

### Credential Auto-Detection

`getConfiguredSecretKeys()` scans `process.env` for keys matching credential patterns (`*_TOKEN`, `*_API_KEY`, `*_SECRET`, `*_WEBHOOK`, `*_PASSWORD`). These are listed in the planner system prompt so the LLM knows which credentials are available when generating workflows.

### Executor Environment

When running agent steps in local mode, CueClaw sets the following env vars for the Claude Code subprocess:

| Variable | Source | Description |
|----------|--------|-------------|
| `ANTHROPIC_AUTH_TOKEN` | `claude.executor.api_key` → `claude.api_key` | API key for the executor subprocess |
| `ANTHROPIC_BASE_URL` | `claude.executor.base_url` → `claude.base_url` | API base URL (only set if non-default) |

The executor-specific fields (`claude.executor.api_key`, `claude.executor.base_url`) override the global values when set. Env vars are restored to their previous values after each step execution.

## Multi-Model Strategy

| Module | Recommended Model | Rationale |
|--------|------------------|-----------|
| **Planner** | Claude Sonnet | Balances cost and quality; plan generation is frequent |
| **Executor** (agent) | Claude Sonnet | Workhorse for code execution |
| **Complex architecture** | Claude Opus | Deep reasoning, manual switch via `--model opus` |
| **Trigger script validation** | Claude Haiku | Lightweight validation, low cost |
