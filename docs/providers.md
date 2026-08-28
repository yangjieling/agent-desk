# Providers

## Agent backends

Register via `registerAgentBackend()` in `@agent-desk/provider-agent`.

| ID | Package | Notes |
|----|---------|-------|
| `claude` | `@agent-desk/provider-agent-claude` | Requires Claude Code CLI |

## Issue providers

Bug / ticket **source of truth**. Selected by `Settings.providers.issue`.

| ID | Package | Notes |
|----|---------|-------|
| `manual` | `@agent-desk/provider-issue-manual` | In-memory store for demos (default) |
| `github` | `@agent-desk/provider-issue-github` | GitHub Issues via REST API |

### GitHub setup

```bash
export AD_GITHUB_TOKEN=ghp_xxx          # classic PAT: repo scope; fine-grained: Issues read/write
export AD_GITHUB_REPO=owner/repo        # e.g. acme/my-app
# optional:
# export AD_GITHUB_PROJECT_DIR=/path/to/checkout
# export AD_GITHUB_API_BASE=https://api.github.com

# point settings at github (PUT /api/settings):
# { "providers": { "agent": "claude", "issue": "github", "notify": "webhook" } }
```

Then:

```bash
pnpm cli issues list
pnpm cli issues show '#12'
curl 'http://127.0.0.1:19877/api/issues?state=open'
```

`issueCode` on tasks uses `#<number>` (e.g. `#12`).

## Notify providers

Gate / task **notifications**. Selected by `Settings.providers.notify`.

| ID | Package | Notes |
|----|---------|-------|
| `webhook` | `@agent-desk/provider-notify-webhook` | POST JSON to `AD_NOTIFY_WEBHOOK_URL` (default) |
| `feishu` | `@agent-desk/provider-notify-feishu` | Feishu / Lark interactive cards (URL deep-link to local web) |
| `dingtalk` | `@agent-desk/provider-notify-dingtalk` | DingTalk ActionCard (群机器人 webhook 或工作通知) |

### Feishu setup

1. Create a custom app in [Feishu Open Platform](https://open.feishu.cn/) (or Lark).
2. Enable bot capability; grant `im:message` / send message as bot.
3. Publish the app and add the bot to a chat, or get your `open_id`.
4. Configure env and switch provider:

```bash
export AD_FEISHU_APP_ID=cli_xxx
export AD_FEISHU_APP_SECRET=xxx
export AD_FEISHU_RECEIVE_ID=ou_xxx          # or email / chat_id
export AD_FEISHU_RECEIVE_ID_TYPE=open_id    # open_id | email | chat_id | user_id | union_id
# optional (Lark intl):
# export AD_FEISHU_API_BASE=https://open.larksuite.com

# PUT /api/settings
# { "providers": { "agent": "claude", "issue": "github", "notify": "feishu" }, "notifyEnabled": true }
```

Gate cards include up to 3 choice buttons. Each button opens a **local** URL:

`GET http://127.0.0.1:19877/api/tasks/<id>/resume?reply=<choice>`

Keep `oh web` running so the browser can hit localhost. This avoids a public callback relay (same idea as JingME deep-link).

### DingTalk setup

**方式 A — 群自定义机器人（推荐上手）**

1. 钉钉群 → 智能群助手 → 添加机器人 → 自定义 → 安全设置选「加签」或「自定义关键词」。
2. 复制 Webhook：

```bash
export AD_DINGTALK_WEBHOOK='https://oapi.dingtalk.com/robot/send?access_token=...'
export AD_DINGTALK_SECRET='SEC...'   # 若启用了加签
```

**方式 B — 企业内部应用工作通知（发到个人）**

```bash
export AD_DINGTALK_APP_KEY=...
export AD_DINGTALK_APP_SECRET=...
export AD_DINGTALK_AGENT_ID=...
export AD_DINGTALK_USER_IDS=userid1,userid2
```

然后：

```bash
# PUT /api/settings
# { "providers": { "agent": "claude", "issue": "github", "notify": "dingtalk" }, "notifyEnabled": true }
```

按钮同样深链本机 `GET /api/tasks/<id>/resume?reply=...`。默认会用 `dingtalk://…/page/link` 包装链接以便 PC 端外开浏览器；可用 `AD_DINGTALK_WRAP_LINKS=0` 关闭。

## Adding a provider

1. Implement the interface in a new package under `packages/provider-*`.
2. Call `register*()` at server/CLI startup (see `packages/server/src/index.ts`).
3. Set default in `Settings.providers` (`packages/core/src/types.ts`).

Internal-only providers (JingME, Xingyun) should live in a **private** repo (e.g. `@hiboos/provider-notify-jingme`) and depend on the public interfaces only.
