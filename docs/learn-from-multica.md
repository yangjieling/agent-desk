# 向 Multica 学习的清单

对照仓库内 `../multica` 与当前 agent-desk 能力整理。目标：**吸收对象模型、执行可靠性与协作触发面**，同时保留 agent-desk 的差异化——本地优先、YAML 工作流、`oh-choices` 闸门、SQLite、精简 monorepo。

状态列含义：

| 状态 | 含义 |
| --- | --- |
| **已有** | agent-desk 已具备等价或近似能力 |
| **可做 MVP** | 不偏离本地优先定位，下一阶段可小步落地 |
| **长期** | 有价值，但依赖更多基础设施或产品形态变化 |

---

## 一句话对照

| | agent-desk | Multica |
| --- | --- | --- |
| 定位 | 本地 harness：编排 + 闸门 | 团队工作区：人机同看板 |
| 最该学 | 身份、排队执行、协作记忆、触发面 | — |
| 不必急着学 | — | 移动端、Cloud、完整多租户 SaaS |

---

## P0 — 概念与产品模型

| # | 主题 | Multica 做法 | agent-desk 现状 | 状态 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 1 | Issue ≠ Task | Issue 是持续工作；Task 是一次执行；一个 Issue 可有多次运行 | 任务生命周期偏「一次跑完」 | **可做 MVP** | Schema 拆「工作项 + 执行记录」；保留现有 task API 兼容层 |
| 2 | Agent 是队友身份 | 名字、指令、模型、Skills、Access、绑定 Runtime | 基本是 `codingAgent: claude/codex/cursor` | **可做 MVP** | 可命名、可复用的 Agent 配置，再映射到现有 provider |
| 3 | 控制面 / 执行面分离 | 服务端排队；本机 daemon claim 再 spawn CLI | 单机 Fastify 直跑 | **可做 MVP** | 即使仍本地优先，也可引入「队列领取 + 心跳」；远程机为长期 |
| 4 | 多种触发入口 | 分配 / @提及 / Chat / Autopilot | 建任务 / 跑 workflow / GitHub 修缺陷 | **可做 MVP** | 先扩「分配到 Agent」与定时；Chat/@ 可后置 |
| 5 | 人只在关键点出现 | Inbox + `in_review` | 已有 `oh-choices` 闸门与通知深链 | **已有**（闸门）/ **可做 MVP**（Inbox、验收态） | 闸门保留；补待办收件箱与「待验收」状态 |

---

## P1 — 运行与可靠性

| # | 主题 | Multica 要点 | agent-desk 现状 | 状态 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 6 | 任务队列与重试 | `queued → running → failed`、自动重试、取消、离线等待 | workflow 节点有 `onFailure: retry`；全局队列/重试不完整 | **可做 MVP** | 统一 runner 级重试与失败原因码 |
| 7 | 并发与工作目录锁 | daemon/agent 并发上限；同目录互斥 | 无显式目录锁与全局并发上限 | **可做 MVP** | 避免同 workspace 并行互相踩 |
| 8 | 执行可观测性 | 工具调用级时间轴；Token/费用可见 | 有 stdout/stderr 时间轴与原始 JSONL | **已有**（日志）/ **可做 MVP**（用量） | 先解析各 CLI 用量事件再汇总 |
| 9 | 安全边界说清楚 | 「不假装沙箱」+ 专用用户/容器；任务级 token、独立 workdir | 文档较少；本地用户权限即边界 | **可做 MVP** | 补 `docs/security.md`；可选独立 workdir |
| 10 | Runtime 发现 | daemon 扫 PATH、注册多 CLI、心跳在线 | 设置里选默认 Agent；启动时假定 CLI 已装 | **可做 MVP** | 启动时探测 + UI 展示可用后端 |

---

## P2 — 协作与编排

| # | 主题 | Multica 要点 | agent-desk 现状 | 状态 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 11 | 评论时间线作共享记忆 | 进度、决策、@派活挂在同一 Issue | 任务日志为主；无跨运行共享讨论流 | **可做 MVP** | 工作项下挂评论/事件流，闸门回复写入其中 |
| 12 | Squads（队长路由） | Leader 读上下文 → `@` 派成员 → evaluation | workflow `independent` 可并行子任务，无「队长路由」语义 | **长期** | 先把 Agent 身份与触发做稳再引入 |
| 13 | Autopilot | cron + Webhook + Runbook；建 Issue vs 仅运行 | 无内置调度；可靠外部 cron 调 CLI | **可做 MVP** | 本地 cron 表或轻量调度器即可起步 |
| 14 | 双向 Channel | IM 可触发/跟进 Agent，不只通知 | Webhook / 飞书 / 钉钉偏出站通知 | **已有**（通知）/ **长期**（入站触发） | 出站保持；入站需签名校验与幂等 |
| 15 | Workspace + 角色 | 多工作区；owner/admin/member | 单用户本地 `~/.agent-desk` | **长期** | 本地优先下可先做「多 profile」而非完整 RBAC |

---

## P3 — 生态与扩展

| # | 主题 | Multica 要点 | agent-desk 现状 | 状态 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 16 | 更多 Agent Provider | ~26 种 CLI | Claude / Codex / Cursor | **可做 MVP** | 按 `@agent-desk/provider-agent` 接口按需扩 |
| 17 | 插件契约 | Manifest：surfaces / hooks / MCP / skills；能力矩阵显式失败 | Provider 可插拔；无统一 plugin manifest | **长期** | 先稳 OpenAPI 与 provider，再考虑插件宿主 |
| 18 | Public API + OpenAPI | 较完整的 public API | `schemas/openapi.yaml` 已规划 | **可做 MVP** | 与 architecture Phase 2 对齐 |
| 19 | VCS 多后端 | GitHub / GitLab / Gitea / Forgejo | GitHub Issues ✅ | **可做 MVP**（GitLab）/ **长期**（全覆盖） | 沿 `provider-issue-*` 扩展 |
| 20 | Skills 工作区共享 | Skill 挂多 Agent；指令=身份、Skill=怎么做 | Skills 已可同步/挂载到任务 | **已有** | 可加强「绑定到 Agent 配置」而非仅任务级 |
| 21 | 项目与资源绑定 | Project 挂仓库/目录 | 任务选工作区目录；GitHub 可自动 clone | **已有**（弱）/ **可做 MVP** | 显式 Project 实体可选 |
| 22 | 桌面端 / daemon UX | 打开即注册本机 Runtime | `oh web` + 浏览器 | **长期** | 产品成熟后再做 |

---

## 建议落地顺序

1. **对象模型**：Agent 身份配置 → Issue/工作项 与 Task/执行 拆分（#2 → #1）。
2. **执行底座**：队列 / 重试 / 并发与目录锁 / Runtime 探测（#6、#7、#10）。
3. **人机界面**：Inbox + 验收态；评论流承接闸门与决策（#5、#11）。
4. **触发面**：Autopilot（cron/Webhook）（#13）。
5. **生态**：OpenAPI、更多 provider、GitLab（#18、#16、#19）。
6. **协作加深**：Squads、双向 IM、多 workspace（#12、#14、#15）。

---

## 刻意不照搬

- 完整 Cloud / 多租户 SaaS、移动端、桌面端全家桶。
- 用看板 UI 取代 YAML workflow + `oh-choices`（闸门协议是 agent-desk 锋芒）。
- 为对齐 Multica 而放弃 SQLite 本地优先核心（远程 daemon 可作为可选模式，而非默认）。

---

## Multica 精读入口（仓库内）

| 主题 | 路径 |
| --- | --- |
| 核心对象 | `multica/apps/docs/content/docs/concepts.zh.mdx` |
| 一次执行链路 | `multica/apps/docs/content/docs/how-multica-works.zh.mdx` |
| Daemon / Runtime | `multica/apps/docs/content/docs/daemon-runtimes.zh.mdx` |
| Task 状态与重试 | `multica/apps/docs/content/docs/tasks.zh.mdx` |
| 小队 | `multica/apps/docs/content/docs/squads.zh.mdx` |
| 自动化 | `multica/apps/docs/content/docs/autopilots.zh.mdx` |
| 收件箱 | `multica/apps/docs/content/docs/inbox.zh.mdx` |
| 安全模型 | `multica/apps/docs/content/docs/security-model.zh.mdx` |
| 插件能力矩阵 | `multica/server/pkg/plugincontract/capabilities.go` |
| 产品愿景 / 功能面 | `multica/VISION.zh.md`、`multica/README.zh.md` |

---

## 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-09-01 | 初版：对照 agent-desk 与仓库内 Multica 整理 P0–P3 清单 |
