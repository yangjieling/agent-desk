# agent-desk

Open-source **Agent task harness**: workflows, human gates, and pluggable providers.

This repository is **independent** from the internal `quality-shipyard/hb-cli` Python project. It shares **JSON Schemas** and API shape, not runtime code.

## Features (v0.2)

- Task lifecycle: `created → running → awaiting → done | failed | stopped`
- **Workflow engine**: shared / independent modes, YAML templates, multi-step orchestration
- Human gate parsing (`## hb-choices`, abort replies like `先不修`)
- **Web UI**: overview dashboard, task list, gates, workflow templates & runs, skills
- Pluggable providers:
  - **Agent**: Claude Code (`provider-agent-claude`)
  - **Issue**: manual (`provider-issue-manual`) or **GitHub Issues** (`provider-issue-github`)
  - **Notify**: webhook / **Feishu** / **DingTalk**
- **Skills**: portable `SKILL.md` packs (discover + prompt/`--add-dir` mount); bundled coding skills sync to `~/.agent-desk/skills` on web start — see [docs/skills.md](docs/skills.md)
- SQLite persistence (`~/.agent-desk/agent-desk.db`)
- Local HTTP API (Fastify) + CLI

## Quick start

```bash
cd agent-desk
pnpm install
pnpm build

# Start web server + UI in background (default, does not block terminal)
pnpm cli web

# Foreground mode (blocks terminal, like before)
pnpm cli web --foreground

# Stop background server
pnpm cli web --stop

# List workflow templates
pnpm cli workflows list

# Run fix pipeline workflow
pnpm cli workflows run sys-fix-pipeline -p "Issue: login button broken"

# Create a single skill task
pnpm cli tasks create \
  -t "Demo task" \
  -p "Say hello and open gate「Demo」with hb-choices." \
  --skill triage

# List discovered skills
pnpm cli skills list

# Install/update bundled skills into ~/.agent-desk/skills
pnpm cli skills sync

# List issues (GitHub when configured)
pnpm cli issues list
pnpm cli issues show '#12'

# List tasks
pnpm cli tasks list
```

**CLI troubleshooting**

- Run commands from the **repo root** (`agent-desk/`), not `packages/cli/`.
- After clone or dependency changes: `pnpm install && pnpm build`.
- `pnpm --filter @agent-desk/cli exec oh` does **not** work — `pnpm exec` only resolves bins from dependencies, not the package’s own `bin`. Use:
  - `pnpm cli <subcommand>` (recommended)
  - `oh <subcommand>` after `npm link` in `packages/cli`
- `pnpm --filter @agent-desk/cli run oh -- <subcommand>`
  - `pnpm --filter @agent-desk/cli run tasks:list`

Open the browser at `http://127.0.0.1:19877` for the Web UI.

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
| `AD_PORT` | Server port (default `19877`; hb-cli uses `19876`) |
| `AD_HOST` | Server host (default `127.0.0.1`) |
| `AD_CLAUDE_BIN` | Claude CLI binary (default `claude`) |
| `AD_NOTIFY_WEBHOOK_URL` | Webhook URL for gate/task notifications |
| `AD_GITHUB_TOKEN` | GitHub PAT for Issues API |
| `AD_GITHUB_REPO` | `owner/repo` for GitHub Issues provider |
| `AD_GITHUB_PROJECT_DIR` | Optional default `projectDir` on mapped issues |
| `AD_GITHUB_API_BASE` | Optional API host (GHES); default `https://api.github.com` |
| `AD_FEISHU_APP_ID` | Feishu / Lark app id |
| `AD_FEISHU_APP_SECRET` | Feishu / Lark app secret |
| `AD_FEISHU_RECEIVE_ID` | Recipient (`open_id` / email / `chat_id`, …) |
| `AD_FEISHU_RECEIVE_ID_TYPE` | Default `open_id` |
| `AD_FEISHU_API_BASE` | Default `https://open.feishu.cn` (Lark intl: `https://open.larksuite.com`) |
| `AD_DINGTALK_WEBHOOK` | DingTalk custom robot webhook URL |
| `AD_DINGTALK_SECRET` | DingTalk robot SEC secret (加签) |
| `AD_DINGTALK_KEYWORD` | Custom keyword injected into card text (自定义关键词) |
| `AD_DINGTALK_APP_KEY` | DingTalk app key (工作通知模式) |
| `AD_DINGTALK_APP_SECRET` | DingTalk app secret |
| `AD_DINGTALK_AGENT_ID` | DingTalk agent id |
| `AD_DINGTALK_USER_IDS` | Comma-separated userids for work notification |
| `AD_DINGTALK_API_BASE` | Default `https://oapi.dingtalk.com` |
| `AD_DINGTALK_WRAP_LINKS` | `1` (default) wrap links for PC external browser |
| `AD_DINGTALK_CARD_TEMPLATE_ID` | Interactive card template id (`xxx.schema`); enables Stream gate cards |
| `AD_DINGTALK_OPEN_API_BASE` | Default `https://api.dingtalk.com` (createAndDeliver) |
| `AD_SKILL_DIRS` | Extra skill roots (`:` / `;` separated) |
| `AD_BUNDLED_SKILL_DIR` | Override bundled `templates/skills` |
| `AD_SKILL_PROMPT_MAX_CHARS` | Cap for injected SKILL.md body (default `100000`) |

DingTalk 也可在 Web **设置 → 钉钉** 写入 `~/.agent-desk`（`Settings.dingtalk`）；非空环境变量仍优先覆盖。改 AppKey/模板后需重启 `oh web` 重连 Stream。

Set `providers.issue` to `"github"` and/or `providers.notify` to `"feishu"` / `"dingtalk"` via the settings UI or PUT `/api/settings`.

## Monorepo layout

```
packages/
  core/                  # Types, gate parsing, limits
  db/                    # SQLite storage
  runner/                # Task execution
  workflow/              # Workflow loader, engine, run store
  server/                # HTTP API + static UI
  ui/                    # Web UI (static HTML/CSS/JS)
  cli/                   # oh CLI (`oh web`, `oh tasks`, …)
  provider-agent/        # Agent backend interface
  provider-agent-claude/ # Claude Code backend
  provider-issue/        # Issue provider interface
  provider-issue-manual/ # In-memory manual issues
  provider-issue-github/ # GitHub Issues
  provider-notify/       # Notify provider interface
  provider-notify-webhook/
  provider-notify-feishu/ # Feishu / Lark cards
  provider-notify-dingtalk/ # DingTalk ActionCard
  skills/                # Skill discovery + mount helpers
schemas/                 # JSON Schema (language-agnostic)
templates/workflows/     # Example workflow YAML
templates/skills/        # Bundled SKILL.md packs (triage/fix/test)
```

## Relationship to hb-cli

| Internal (Python) | Open source (TS) |
|-------------------|------------------|
| `bug_code` | `issueCode` |
| `workflow_runner.py` | `@agent-desk/workflow` |
| `agent_backend.py` | `@agent-desk/provider-agent*` |
| `skill_pack.py` | `@agent-desk/skills` |
| `notify.py` | `@agent-desk/provider-notify*` |
| `bugs.py` | `@agent-desk/provider-issue*` |
| `runner.py` | `@agent-desk/runner` |
| `web.py` + `static/*` | `@agent-desk/server` + `@agent-desk/ui` |

JingME cards, Xingyun bugs, and other internal integrations stay in the private `hiboos-hb` layer as optional providers.

## License

Apache-2.0
