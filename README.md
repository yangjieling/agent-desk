# agent-desk

Open-source **Agent task harness**: workflows, human gates, and pluggable providers.

This repository is **independent** from the internal `quality-shipyard/hb-cli` Python project. It shares **JSON Schemas** and API shape, not runtime code.

## Features (v0.2)

- Task lifecycle: `created → running → awaiting → done | failed | stopped`
- **Workflow engine**: shared / independent modes, YAML templates, multi-step orchestration
- Human gate parsing (`## hb-choices`, abort replies like `先不修`)
- **Web UI**: task list, detail, gate choices, workflow templates & runs
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

# Start web server + UI (default http://127.0.0.1:19876)
pnpm cli web
# or: pnpm exec agent-desk web   (requires pnpm install at repo root)

# List workflow templates
pnpm cli workflows list

# Run fix pipeline workflow
pnpm cli workflows run sys-fix-pipeline -p "Issue: login button broken"

# Create a single skill task
pnpm cli tasks create \
  -t "Demo task" \
  -p "Say hello and open gate「Demo」with hb-choices."

# List tasks
pnpm cli tasks list
```

**CLI troubleshooting**

- Run commands from the **repo root** (`agent-desk/`), not `packages/cli/`.
- After clone or dependency changes: `pnpm install && pnpm build`.
- `pnpm --filter @agent-desk/cli exec agent-desk` does **not** work — `pnpm exec` only resolves bins from dependencies, not the package’s own `bin`. Use:
  - `pnpm cli <subcommand>` (recommended)
  - `pnpm exec agent-desk <subcommand>` from repo root
  - `pnpm --filter @agent-desk/cli run agent-desk -- <subcommand>`
  - `pnpm --filter @agent-desk/cli run tasks:list`

Open the browser at `http://127.0.0.1:19876` for the Web UI.

## Workflow modes

| Mode | Behavior |
|------|----------|
| **shared** | One agent session across all steps; orchestrator injects step prompts |
| **independent** | Each step spawns a separate task in parallel |

Templates live in `templates/workflows/*.yaml`. User workflows can be saved under `~/.agent-desk/workflows/`.

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
  workflow/              # Workflow loader, engine, run store
  server/                # HTTP API + static UI
  ui/                    # Web UI (static HTML/CSS/JS)
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
| `workflow_runner.py` | `@agent-desk/workflow` |
| `agent_backend.py` | `@agent-desk/provider-agent*` |
| `notify.py` | `@agent-desk/provider-notify*` |
| `bugs.py` | `@agent-desk/provider-issue*` |
| `runner.py` | `@agent-desk/runner` |
| `web.py` + `static/*` | `@agent-desk/server` + `@agent-desk/ui` |

JingME cards, Xingyun bugs, and other internal integrations stay in the private `hiboos-hb` layer as optional providers.

## License

Apache-2.0
