# Providers

## Agent backends

Register via `registerAgentBackend()` in `@agent-desk/provider-agent`.

| ID | Package | Notes |
|----|---------|-------|
| `claude` | `@agent-desk/provider-agent-claude` | Requires Claude Code CLI |

## Issue providers

| ID | Package | Notes |
|----|---------|-------|
| `manual` | `@agent-desk/provider-issue-manual` | In-memory store for demos |

## Notify providers

| ID | Package | Notes |
|----|---------|-------|
| `webhook` | `@agent-desk/provider-notify-webhook` | POST JSON to `AD_NOTIFY_WEBHOOK_URL` |

## Adding a provider

1. Implement the interface in a new package under `packages/provider-*`.
2. Call `register*()` at server/CLI startup (see `packages/server/src/index.ts`).
3. Set default in `Settings.providers` (`packages/core/src/types.ts`).

Internal-only providers (JingME, Xingyun) should live in a **private** repo (e.g. `@hiboos/provider-notify-jingme`) and depend on the public interfaces only.
