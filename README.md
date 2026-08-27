# agent-desk

Open-source **Agent task harness**: workflows, human gates, and pluggable providers.

This repository is **independent** from the internal `quality-shipyard/hb-cli` Python project. It shares **JSON Schemas** and API shape, not runtime code.

## Features (v0.1 scaffold)

- Task lifecycle: `created → running → awaiting → done | failed | stopped`
- Human gate parsing (`## hb-choices`, abort replies like `先不修`)
- Pluggable providers:
  - **Agent**: Claude Code (`provider-agent-claude`)
  - **Issue**: manual/local (`provider-issue-manual`)
  - **Notify**: webhook (`provider-notify-webhook`)
- SQLite persistence (`~/.agent-desk/agent-desk.db`)
- Local HTTP API (Fastify) + CLI

## Quick start

```bash
cd agent-desk
pnpm install
pnpm build

# Start API server (default http://127.0.0.1:19876)
pnpm --filter @agent-desk/cli exec agent-desk web

# Create a task from CLI
pnpm --filter @agent-desk/cli exec agent-desk tasks create \
  -t "Demo task" \
  -p "Say hello and open gate「Demo」with hb-choices."
```

## Environment

| Variable | Description |
|----------|-------------|
| `AD_DATA_DIR` | Data directory (default `~/.agent-desk`) |
| `AD_PORT` | Server port (default `19876`) |
| `AD_HOST` | Server host (default `127.0.0.1`) |
| `AD_CLAUDE_BIN` | Claude CLI binary (default `claude`) |
| `AD_NOTIFY_WEBHOOK_URL` | Webhook URL for gate/task notifications |

## Monorepo layout

```
packages/
  core/                  # Types, gate parsing, limits
  db/                    # SQLite storage
  runner/                # Task execution
  server/                # HTTP API
  cli/                   # agent-desk CLI
  provider-agent/        # Agent backend interface
  provider-agent-claude/ # Claude Code backend
  provider-issue/        # Issue provider interface
  provider-issue-manual/ # In-memory manual issues
  provider-notify/       # Notify provider interface
  provider-notify-webhook/
schemas/                 # JSON Schema (language-agnostic)
templates/workflows/     # Example workflow YAML
```

## Relationship to hb-cli

| Internal (Python) | Open source (TS) |
|-------------------|------------------|
| `bug_code` | `issueCode` |
| `agent_backend.py` | `@agent-desk/provider-agent*` |
| `notify.py` | `@agent-desk/provider-notify*` |
| `bugs.py` | `@agent-desk/provider-issue*` |
| `runner.py` | `@agent-desk/runner` |
| `web.py` | `@agent-desk/server` |

JingME cards, Xingyun bugs, and other internal integrations stay in the private `hiboos-hb` layer as optional providers.

## License

Apache-2.0
