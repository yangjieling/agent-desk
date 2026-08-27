# Architecture

## Design goals

1. **Pluggable providers** — Agent, Issue, and Notify backends are swappable.
2. **Schema-first** — Task/Workflow/Settings/Gate schemas live in `schemas/` and can be shared with Python hb-cli without sharing code.
3. **Local-first** — SQLite + localhost API; no cloud dependency for the OSS core.

## Package graph

```mermaid
flowchart TB
  cli --> server
  cli --> runner
  cli --> workflow
  server --> runner
  server --> workflow
  server --> ui
  workflow --> runner
  workflow --> core
  runner --> core
  runner --> db
  runner --> provider-agent
  runner --> provider-notify
  server --> db
  db --> core
  provider-agent-claude --> provider-agent
  provider-issue-manual --> provider-issue
  provider-notify-webhook --> provider-notify
```

## Task state machine

```mermaid
stateDiagram-v2
  [*] --> created
  created --> running: start
  running --> awaiting: agent asks gate
  running --> done: success
  running --> failed: error/exit!=0
  running --> stopped: user stop / abort reply
  awaiting --> running: resume(reply)
  awaiting --> stopped: abort reply
  done --> [*]
  failed --> [*]
  stopped --> running: resume("继续")
```

## Gate protocol

Agents signal a human gate by including:

```markdown
## 闸门「Triage」

Please confirm next step.

## hb-choices
- 继续修复 | continue
- 先不修 | skip
```

The runner parses `hb-choices`, sets status to `awaiting`, and optionally sends a webhook notification.

Abort replies (`skip`, `cancel`, `先不修`, …) stop the task instead of advancing.

## Phase 2 (partially done in v0.2)

- Web UI package (`@agent-desk/ui`) — task list, gates, workflow runs
- Workflow engine — shared / independent modes, YAML templates
- OpenAPI spec under `schemas/openapi.yaml` (planned)
- Additional providers (GitHub Issues, Slack, Cursor SDK)
