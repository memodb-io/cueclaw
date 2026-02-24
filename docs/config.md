# Configuration

## Config File

```yaml
# ~/.cueclaw/config.yaml (global) or .cueclaw/config.yaml (project-level)

claude:
  api_key: ${ANTHROPIC_API_KEY}
  base_url: https://api.anthropic.com
  planner:
    model: claude-sonnet-4-6
  executor:
    model: claude-sonnet-4-6

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
    # bridge: workflows needing external API calls (e.g., gh, curl)
    # host: full host network access (least secure)
    # Can be overridden per-workflow in the workflow's container config
```

**Config priority** (low → high): `~/.cueclaw/config.yaml` → `./.cueclaw/config.yaml` → env vars → CLI args

`${ENV_VAR}` interpolation is supported in YAML values.

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

## Multi-Model Strategy

| Module | Recommended Model | Rationale |
|--------|------------------|-----------|
| **Planner** | Claude Sonnet | Balances cost and quality; plan generation is frequent |
| **Executor** (agent) | Claude Sonnet | Workhorse for code execution |
| **Complex architecture** | Claude Opus | Deep reasoning, manual switch via `--model opus` |
| **Trigger script validation** | Claude Haiku | Lightweight validation, low cost |
