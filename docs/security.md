# Security model (local-first)

agent-desk is a **local harness**, not a cloud sandbox. This document states the real process boundary honestly — the same posture as [Multica’s security model](https://github.com/multica-ai/multica/blob/main/apps/docs/content/docs/security-model.mdx): **do not pretend agents are isolated** when they run with your shell powers.

## TL;DR

- Agent CLIs (`claude`, `codex`, `cursor`, …) are spawned as **the same OS user** that runs `oh web` / the runner.
- They inherit **`process.env`**, your **home directory**, credentials, and network access of that user.
- Soft gates (`oh-choices`, dangerous-command pause) and workspace locks **reduce mistakes**; they are **not** a filesystem or network jail.

If you need stronger isolation, put it **outside** agent-desk (dedicated Unix user → container → VM).

## Threat model

| Risk | Why it matters locally |
| --- | --- |
| Confused / malicious agent output | Agent can run shell tools with your privileges |
| Leaked settings secrets | GitHub / DingTalk / webhook tokens live under `~/.agent-desk` |
| Concurrent tasks on one checkout | Shared `projectDir` can race (mitigated by optional workspace lock) |

Out of scope for this doc: multi-tenant SaaS, remote daemon claim, Multica-style per-task API tokens.

## What actually runs

Typical path:

1. UI / Autopilot / CLI creates a **Task** with `projectDir` + prompt.
2. Control plane **enqueues** the task (`queued`); it does not spawn the CLI.
3. In-process **LocalExecutor** claims under a heartbeat lease (`dispatched`), then the runner resolves the agent provider and builds argv (`buildExecCommand`).
4. `spawn(cli, args, { cwd: projectDir, env: process.env, … })` starts the CLI.
5. Stream-json / stdout is appended to `task.result` for the session UI.

There is **no** separate agent OS user, **no** per-task `HOME`, and **no** nested Multica control-plane token. Remote daemon claim is out of scope for this local-first MVP.

## Provider permission flags (soft, not boundaries)

| Provider | Notable flags |
| --- | --- |
| Claude Code | Often `--dangerously-skip-permissions` so tools are not blocked by Claude’s own prompts |
| Cursor agent | `--force` / `--trust` style flags for non-interactive runs |
| Codex | Depends on host Codex config; agent-desk does not add an extra FS sandbox |

These flags make unattended runs practical; they **widen** autonomy relative to interactive CLI defaults.

## Soft mitigations (not isolation)

| Mechanism | What it does |
| --- | --- |
| Human gates (`## oh-choices` / heuristic questions) | Task → `awaiting` until you resume |
| Dangerous-command pause | Regex match on risky shell lines (e.g. `git push`, `rm -rf`) → gate |
| Workspace lock | Optional: one active task per `projectDir` |
| Settings secret masking | API can hide stored secrets behind a mask; reveal is explicit |
| Work-item acceptance (`in_review`) | Delivery ≠ accepted; human Accept/Reject |

Treat these as **product brakes**, not a security boundary.

## Recommended setups

Copy Multica’s ladder, adapted for local-first:

1. **Dedicated Unix user** for agent-desk (separate from day-to-day login) — simplest real boundary.
2. **Container** with a mounted workdir and scoped secrets — better for shared machines.
3. **VM** — when you need a hard line from corp laptop secrets.

Also:

- Prefer scoped tokens (`AD_GITHUB_TOKEN`, notify credentials) over broad PATs.
- Keep `oh web` bound to localhost unless you intentionally expose it.
- Do not commit `~/.agent-desk` SQLite or secret files.

## What we do *not* claim

- Filesystem sandbox or network allowlists inside agent-desk.
- Per-task `CODEX_HOME` / isolated skill caches (optional future).
- Multica `MULTICA_TOKEN` or cloud quota enforcement.
- That Autopilot / auto gate confirm is “safe unattended” without reviewing Runbooks.

## Related

- [docs/architecture.md](./architecture.md) — local harness layout
- [docs/providers.md](./providers.md) — CLI providers
- [docs/learn-from-multica.md](./learn-from-multica.md) — checklist item #9
- Multica: security model (external) — same “OS user is the boundary” idea
