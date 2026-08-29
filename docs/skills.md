# Skills

Portable **instruction packs** for coding agents. Inspired by hb-cli `skill_pack` (prompt inject + `--add-dir`) and deepseek-harness `SKILL.md` (frontmatter + layered discovery).

## Model

| Layer | Responsibility |
|-------|----------------|
| **Descriptor** | `id` / `name` / `description` / `instructions` — harness truth |
| **Registry** | Discover & merge from disk roots |
| **Install sync** | Copy bundled → `~/.agent-desk/skills` with versioned updates |
| **Mount** | At task start: prepend prompt block; pass dirs to Agent backend |
| **Agent adapter** | Claude: `--add-dir`; others can ignore dirs and still get prompt text |

Workflow nodes and tasks still store a **skill id string**. The runner resolves that id when spawning the agent — skill bodies are **not** stored in SQLite.

## Bundled skills

**Built-in (CLI-managed)** — `templates/skills/`: `triage`, `fix`, `test`

**User seeds (from hb-cli, removable)** — `templates/skill-seeds/`: `bug-fix`, `bug-fix-report`, `code-review`, `coding-impl`, `code-merge`, `api-selftest`, `function-test`

JD-internal tools are **not** shipped. Re-import seeds:

```bash
pnpm skills:import   # needs sibling ../quality-shipyard/.joycode/skills
pnpm build && pnpm cli skills sync
```

## Built-in vs user skills

| 类型 | 来源 | 管理 | 卸载 |
|------|------|------|------|
| **内置** | `templates/skills` → sync 写 `.ad-skill-meta.json` | `oh skills sync` | 否 |
| **用户自建 / 种子** | `templates/skill-seeds` 首次拷贝，或手放到 `~/.agent-desk/skills/` | 不随 CLI 强制更新 | `oh skills uninstall` |
| **项目** | `<repo>/.agent-desk/skills` | 跟仓库 | 否 |

开源包：公共内置三件套随 CLI 更新；hb-cli 编码包仅作**一次种子**装成用户技能，可卸载。

## Install & update (like hb-cli)

On **`oh web` / server start**, agent-desk runs `ensureSkillsReady`:

1. Sync **built-in** (`triage` / `fix` / `test`) with versioned managed installs
2. **Demote** any former managed skills no longer in the built-in manifest (hb-cli packs → user)
3. **Seed** missing packs from `templates/skill-seeds` as user skills (no managed meta; never overwrite)

Manual:

```bash
pnpm cli skills sync          # builtin update + seed missing + demote
pnpm cli skills sync --force  # reinstall managed builtin
pnpm cli skills uninstall bug-fix   # ok for seeded / user skills
```

Web：**技能** 页 → **同步内置**. API: `POST /api/skills/sync` `{ "force": false }`.

User-owned dirs (have `SKILL.md` but no managed meta) are **not** overwritten unless `--force`.

## On-disk format

Bundle (preferred):

```text
<name>/SKILL.md
<name>/scripts/     # optional
<name>/references/  # optional (agent can Read via --add-dir)
```

Or flat: `<name>.md`.

Frontmatter:

```markdown
---
version: 1.0.9
name: bug-fix
description: …
---
```

## Discovery order (first / lower rank wins)

| Rank | Source | Root |
|------|--------|------|
| 100 | `project-agent-desk` | `<gitRoot>/.agent-desk/skills` |
| 200 | `project-agents` | `<gitRoot>/.agents/skills` |
| 300 | `custom` | `AD_SKILL_DIRS` |
| 400 | `user` | `~/.agent-desk/skills` (synced installs live here) |
| 600 | `bundled` | `templates/skills` |

## Injection (Claude)

On `startTask`: `mountSkill` → prompt prefix + `--add-dir`. Missing skill → hint, no hard fail.

## API / CLI

```bash
pnpm cli skills list
pnpm cli skills sync
pnpm cli tasks create -t "修登录" -p "…" --skill bug-fix

curl 'http://127.0.0.1:19877/api/skills'
curl 'http://127.0.0.1:19877/api/skills/bug-fix'
curl -X POST 'http://127.0.0.1:19877/api/skills/sync' -H 'content-type: application/json' -d '{}'
```

Web UI：侧栏 **技能** 可浏览、查看正文、同步内置、一键选用。

## Package

`@agent-desk/skills` — discovery, mount, `syncBundledSkills`.  
Schema: `schemas/skill.schema.json`.
