# Providers

## Agent backends

Register via `registerAgentBackend()` in `@agent-desk/provider-agent`.

| ID | Package | Notes |
|----|---------|-------|
| `claude` | `@agent-desk/provider-agent-claude` | Requires Claude Code CLI |
| `codex` | `@agent-desk/provider-agent-codex` | Requires Codex CLI (`codex exec`) |

## Issue providers

Bug / ticket **source of truth**. Selected by `Settings.providers.issue`.

| ID | Package | Notes |
|----|---------|-------|
| `manual` | `@agent-desk/provider-issue-manual` | In-memory store for demos (default) |
| `github` | `@agent-desk/provider-issue-github` | GitHub Issues via REST API |

### GitHub setup

配置优先级：**非空的 `AD_GITHUB_*` 环境变量** > **Web 设置页「GitHub」**（写入 `~/.agent-desk/agent-desk.db` 的 `Settings.github`）。

在 Web：**设置 → 缺陷来源选 GitHub → 填写仓库与 Token**。也可继续用环境变量（非空时覆盖设置页）。

```bash
export AD_GITHUB_TOKEN=ghp_xxx          # classic PAT: repo scope; fine-grained: Issues read/write
export AD_GITHUB_REPO=owner/repo        # e.g. acme/my-app
# optional:
# export AD_GITHUB_PROJECT_DIR=/path/to/checkout
# optional: auto-clone missing repos to ~/.agent-desk/workspaces/auto/<owner>/<repo>
# (user-local clones found by folder name are reused and never deleted)
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

Keep `oh web` running so the browser can hit localhost. This avoids needing a public callback relay.

### DingTalk setup

配置优先级：**非空的 `AD_DINGTALK_*` 环境变量** > **Web 设置页「钉钉」**（写入 `~/.agent-desk/agent-desk.db` 的 `Settings.dingtalk`）。两边有一处配齐即可；`export` 可选保留。

在 Web：**设置 → 通知通道选钉钉 → 填写 AppKey / AppSecret / userid / 模板 ID 等**。改凭证或模板后需重启 `oh web` 才会重连 Stream。

**方式 A — 群自定义机器人（推荐上手）**

1. 钉钉群 → 智能群助手 → 添加机器人 → 自定义 → 安全设置选「加签」或「自定义关键词」。
2. 在设置页填 Webhook / Secret / Keyword，或：

```bash
export AD_DINGTALK_WEBHOOK='https://oapi.dingtalk.com/robot/send?access_token=...'
export AD_DINGTALK_SECRET='SEC...'   # 若启用了加签
export AD_DINGTALK_KEYWORD='agent-desk'  # 若启用了自定义关键词（会自动写入正文）
```

**方式 B — 企业内部应用工作通知 / 互动卡片（发到个人）**

在设置页填写，或：

```bash
export AD_DINGTALK_APP_KEY=...
export AD_DINGTALK_APP_SECRET=...
export AD_DINGTALK_AGENT_ID=...          # ActionCard 工作通知需要
export AD_DINGTALK_USER_IDS=userid1,userid2
# optional:
# export AD_DINGTALK_API_BASE=https://oapi.dingtalk.com

# Interactive gate cards (Stream callback → resume, no browser jump):
export AD_DINGTALK_CARD_TEMPLATE_ID='922d2faf-....schema'
# robot must use Stream receive mode; keep only one Stream client per AppKey
```

然后：

```bash
# PUT /api/settings（或 Web 设置页）
# { "providers": { "notify": "dingtalk" }, "notifyEnabled": true,
#   "dingtalk": { "appKey": "...", "appSecret": "...", "userIds": "...", "cardTemplateId": "....schema" } }

# 启动 web（会自动挂 Stream，若配置了卡片模板 + AppKey/Secret）：
oh web --foreground

# 或单独监听回调（勿与 oh web 同时开）：
oh notify dingtalk-stream

# 验证配置（发一张测试闸门卡片）：
oh notify test --provider dingtalk
```

- **未配置** 卡片模板 ID：仍发 ActionCard，按钮深链本机 `GET /api/tasks/<id>/resume?reply=...`（可用 `AD_DINGTALK_WRAP_LINKS=0` 关闭 dingtalk:// 包装）。
- **已配置** 模板 ID：闸门发互动卡片，点按钮 / 提交输入经 Stream 回调直接 `resumeTask`。

## Adding a provider

1. Implement the interface in a new package under `packages/provider-*`.
2. Call `register*()` at server/CLI startup (see `packages/server/src/index.ts`).
3. Set default in `Settings.providers` (`packages/core/src/types.ts`).

Organization-specific providers can live in a separate private repo and depend on the public interfaces only.
