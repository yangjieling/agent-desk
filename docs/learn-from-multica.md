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
| 1 | Issue ≠ Task | Issue 是持续工作；Task 是一次执行；一个 Issue 可有多次运行 | WorkItem（`wi_`）+ Task 执行记录；缺陷页「工作项」时间线 | **已有**（MVP） | 保留 `issueCode` 与 task API；`workItemId` 可选 |
| 2 | Agent 是队友身份 | 名字、指令、模型、Skills、Access、绑定 Runtime | 可命名 Agent 配置（provider/model/skill/instructions）+ 任务/workflow 绑定 | **已有** | 设置页 CRUD；新建任务与流程步骤可选 Agent |
| 3 | 控制面 / 执行面分离 | 服务端排队；本机 daemon claim 再 spawn CLI | 本机 LocalExecutor：入队 → claim → 心跳 → spawn；`GET /api/executor` | **已有**（MVP） | 同进程内分离；远程 daemon 为长期 |
| 4 | 多种触发入口 | 分配 / @提及 / Chat / Autopilot | 建任务 / 跑 workflow / GitHub 修缺陷 / Autopilot cron+Webhook / **分配 Agent / 备注 @提及** | **已有**（MVP） | Autopilot ✅；`POST …/assign`；备注 `@Name` / `mention://agent/…`；Chat 可后置 |
| 5 | 人只在关键点出现 | Inbox + `in_review` | 待办聚合闸门 `awaiting` + 工作项 `in_review` 验收 | **已有**（MVP） | 闸门快捷回复；Accept/Reject；任务完成≠工作项完成 |

---

## P1 — 运行与可靠性

| # | 主题 | Multica 要点 | agent-desk 现状 | 状态 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 6 | 任务队列与重试 | `queued → running → failed`、自动重试、取消、离线等待 | runner 级自动重试 + 工作区排队；失败原因码；设置页可配 | **已有**（MVP） | workflow 步骤 `onFailure: retry/continue` 已接入共享模式 |
| 7 | 并发与工作目录锁 | daemon/agent 并发上限；同目录互斥 | 设置项 `workspaceLockEnabled`；同 `projectDir` 仅一个 active 任务 | **已有** | 独立并行 workflow 与互斥冲突时需关闭互斥或换目录 |
| 8 | 执行可观测性 | 工具调用级时间轴；Token/费用可见 | 日志时间轴 + Claude 用量 chip（解析 `result` JSONL） | **已有**（日志）/ **已有**（用量 MVP） | Codex/Cursor 用量与汇总页后置 |
| 9 | 安全边界说清楚 | 「不假装沙箱」+ 专用用户/容器；任务级 token、独立 workdir | [docs/security.md](./security.md)；本地用户即边界 | **已有**（文档） | 可选独立 workdir 后置 |
| 10 | Runtime 发现 | daemon 扫 PATH、注册多 CLI、心跳在线 | 启动探测 + `GET /api/runtimes`；设置页与智能体页展示 CLI 状态 | **已有**（MVP） | 启动日志、`?fresh=1` 重探测；远程 daemon 心跳为长期 |

---

## P2 — 协作与编排

| # | 主题 | Multica 要点 | agent-desk 现状 | 状态 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 11 | 评论时间线作共享记忆 | 进度、决策、@派活挂在同一 Issue | 工作项事件流（备注 / 闸门决策 / 执行关联 / **@提及派活**）；弹窗内展示 | **已有**（MVP） | 备注 `@` 可唤醒；无回复线程；闸门回复自动写入 |
| 12 | Squads（队长路由） | Leader 读上下文 → `@` 派成员 → evaluation | workflow `independent` 可并行子任务，无「队长路由」语义 | **长期** | 先把 Agent 身份与触发做稳再引入 |
| 13 | Autopilot | cron + Webhook + Runbook；建 Issue vs 仅运行 | cron + Webhook 入站 + Runbook；技能任务 / 流程；「自动化」页 | **已有**（MVP） | `POST /api/webhooks/autopilots/:token`；HMAC + 幂等；需 `oh web` |
| 14 | 双向 Channel | IM 可触发/跟进 Agent，不只通知 | Webhook / 飞书 / 钉钉偏出站通知 | **已有**（通知）/ **长期**（入站触发） | 出站保持；入站需签名校验与幂等 |
| 15 | Workspace + 角色 | 多工作区；owner/admin/member | 单用户本地 `~/.agent-desk` | **长期** | 本地优先下可先做「多 profile」而非完整 RBAC |

---

## P3 — 生态与扩展

| # | 主题 | Multica 要点 | agent-desk 现状 | 状态 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 16 | 更多 Agent Provider | ~26 种 CLI | Claude / Codex / Cursor | **可做 MVP** | 按 `@agent-desk/provider-agent` 接口按需扩 |
| 17 | 插件契约 | Manifest：surfaces / hooks / MCP / skills；能力矩阵显式失败 | Provider 可插拔；无统一 plugin manifest | **长期** | 先稳 OpenAPI 与 provider，再考虑插件宿主 |
| 18 | Public API + OpenAPI | 较完整的 public API | `schemas/openapi.yaml` + `GET /api/docs` / `/openapi.yaml` | **已有**（MVP） | 本地契约；无 PAT/OAuth/幂等账本 |
| 19 | VCS 多后端 | GitHub / GitLab / Gitea / Forgejo | GitHub Issues ✅；GitLab Issues MVP ✅ | **已有**（GitLab MVP）/ **长期**（Gitea/Forgejo） | `provider-issue-gitlab`；无自动 clone |
| 20 | Skills 工作区共享 | Skill 挂多 Agent；指令=身份、Skill=怎么做 | Skills 可同步；**Agent 绑默认技能 + 附加技能**；运行时一并挂载 | **已有**（MVP） | `AgentProfile.defaultSkill` + `skills[]`；任务页随 Agent 继承主技能 |
| 21 | 项目与资源绑定 | Project 挂仓库/目录 | **显式 Project**（名称 + 本地目录 + 可选 repo URL）；侧栏「项目」+ 工作区选择器「项目」页签 | **已有**（MVP） | 运行时仍写 `projectDir`；`repoUrl` 仅文档、无自动 clone |
| 22 | 桌面端 / daemon UX | 打开即注册本机 Runtime | `oh web` + 浏览器 | **长期** | 产品成熟后再做 |

---

## 建议落地顺序

1. **对象模型**：Agent 身份配置 → Issue/工作项 与 Task/执行 拆分（#2 → #1）。
2. **执行底座**：队列 / 重试 / 并发与目录锁 / Runtime 探测（#6、#7、#10）；控制面/执行面 claim+心跳（#3 ✅）。
3. **人机界面**：Inbox + 验收态；评论流承接闸门与决策（#5、#11）。
4. **触发面**：Autopilot（cron/Webhook）（#13 ✅）。
5. **生态**：OpenAPI ✅ → GitLab Issues MVP ✅ → 更多 agent provider（#16）、Gitea/Forgejo（#19 长期）。
6. **协作加深**：Squads、双向 IM、多 workspace（#12、#14、#15）。

---

## 刻意不照搬

- 完整 Cloud / 多租户 SaaS、移动端、桌面端全家桶。
- 用看板 UI 取代 YAML workflow + `oh-choices`（闸门协议是 agent-desk 锋芒）。
- 为对齐 Multica 而放弃 SQLite 本地优先核心（远程 daemon 可作为可选模式，而非默认）。
- **Multica 的侧栏、页面层级、视觉布局**——学的是能力结构与对象关系，不是菜单长相。

---

## UI 与信息架构（能力驱动）

向 Multica 学的是**对象模型与用户要完成的事**，不是把现有 Web 菜单改成 Multica 同款。若新能力与当前 UI 承载方式不匹配，**允许改导航、新开页面或调整布局**，不要为了塞进现有侧栏而削能力或拧巴交互。

### 原则

| 情况 | 做法 |
| --- | --- |
| 新能力与现有页面自然契合 | 在任务 / 缺陷 / 流程里增强（如 Agent 选择、工作区互斥） |
| 新能力是**新的对象或心智** | 新增入口或独立页面（如「智能体」「待办」），不必塞进「设置」 |
| 现有 UI **承载不了**完整体验 | 先调信息架构，再填功能；避免「有后端、无合适界面」 |

一句话：**先想清楚用户在哪完成这件事，再决定 UI；能力迁就信息架构，而不是信息架构迁就旧菜单。**

### 每项能力落地前自问

1. 用户的主路径是什么？（创建 → 运行 → 闸门 → 验收）
2. 现有「总览 / 缺陷 / 任务 / 流程 / 技能 / 设置」里，哪一页最合适？
3. 若都不合适：是否值得**新开一级导航或详情页**？
4. 是否必须保留 harness 差异化（轻量、本地、流程 + 闸门优先）？

### 导航演进参考（按需、渐进）

非一次性大改，随清单项落地再调整：

| 阶段 | 能力 | UI 方向（示例） |
| --- | --- | --- |
| 现在 | Agent 身份（#2） | 「智能体」侧栏一级页；设置只留全局默认项 ✅ |
| 近期 | 待办 / Inbox（#5） | 侧栏「待办」+ 角标，聚合闸门待确认与工作项待验收 ✅ |
| 近期 | Issue ≠ Task（#1） | 「工作项详情 + 执行记录时间线」，而非单条 task 行塞一切 |
| 中期 | Autopilot（#13） | 独立「自动化」列表 + Runbook 编辑，不硬塞进流程页 ✅ |
| 近期 | Project（#21） | 侧栏「项目」+ 工作区选择器「项目」页签 ✅ |
| 长期 | Runtime / daemon（#3 ✅ 本机 claim、#10） | 「本机运行时」状态页 + 执行器心跳；远程 daemon 仍属长期 |

当前侧栏在 harness 阶段仍合理；「项目 / 智能体 / 自动化 / 待办」已按能力逐步加入，不必为对齐 Multica 再塞「小队 / Chat」等空壳。

任务运行会话区见 [task-session-ui.md](./task-session-ui.md)（**P0–P3 必做项已落地**；可选 P3-4/5 视痛感）。  
总览 / 待办 / 缺陷 / 任务列表的对照与简化顺序见 [work-surfaces-ui.md](./work-surfaces-ui.md)。

### agent-desk UI 目标

比 Multica **更轻、更贴本地 harness**：任务 / 流程 / 闸门一眼能找到；配置与执行分离；新能力到位后再长 UI，而不是先做满 Multica 式导航再等后端。

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
| 2026-09-03 | #21 Project MVP：侧栏「项目」CRUD；工作区选择器项目页签 / 存为项目；自动化可选项目填路径 |
| 2026-09-03 | #20 Agent 绑定 Skills：`skills[]` 附加挂载；智能体页多选；任务页随 Agent 继承 `defaultSkill`；`mountSkills` |
| 2026-09-03 | #4 分配 / @提及：`POST /api/work-items/:id/assign`；备注解析 `@Agent` / `mention://agent/…` 入队；同 Agent 进行中任务合流；工作项弹窗负责人选择 |
| 2026-09-03 | #13 Autopilot Webhook：`POST /api/webhooks/autopilots/:token`；X-Hub-Signature-256；Idempotency-Key / X-GitHub-Delivery 幂等；自动化页可启停/轮换 |
| 2026-09-03 | #3 控制面/执行面分离 MVP：LocalExecutor claim + 心跳；`dispatched` 状态；`GET /api/executor`；HTTP 仅入队 |
| 2026-09-03 | 工作面 UI：**W-1–W-5** 已落地（主线完成）；见 [work-surfaces-ui.md](./work-surfaces-ui.md) |
| 2026-09-03 | #19 GitLab Issues MVP：`@agent-desk/provider-issue-gitlab`；设置页 / CLI / `/api/issues`；无自动 clone |
| 2026-09-03 | 任务会话 UI：P0–P3 必做项已落地（含转录密度）；见 [task-session-ui.md](./task-session-ui.md) |
| 2026-09-02 | #18 OpenAPI MVP：`schemas/openapi.yaml` 覆盖本机 Fastify API；`GET /openapi.yaml`、`/api/openapi.yaml`、`/api/docs`（Swagger UI） |
| 2026-09-02 | #8/#9：Claude 用量 meta chip；`docs/security.md` 说明本地用户边界（不假装沙箱） |
| 2026-09-02 | #13 Autopilot MVP：cron 调度、Runbook→技能任务/流程、自动化页、立即运行/暂停；Webhook 见 2026-09-03 |
| 2026-09-02 | #5 `in_review` 验收态：WorkItem 交付后待验收；Inbox Accept/Reject；不再因任务完成自动关闭工作项 |
| 2026-09-02 | #11 工作项评论/事件流 MVP：gate 决策自动写入、手动备注、工作项弹窗时间线 |
| 2026-09-02 | #1 Issue ≠ Task MVP：WorkItem 表、`/api/work-items`、缺陷页工作项与执行时间线 |
| 2026-09-02 | #10 Runtime 发现：启动探测日志、`GET /api/runtimes`、设置页与智能体页展示 CLI 状态 |
| 2026-09-02 | #6 任务队列与自动重试：bootstrap 队列、设置 UI、失败码与排队状态展示 |
| 2026-09-02 | #5 待办 / Inbox MVP：侧栏入口、`GET /api/inbox`、闸门快捷回复 |
| 2026-09-02 | 补充「UI 与信息架构」：能力驱动演进，不必照搬 Multica 布局 |
| 2026-09-02 | #2 Agent 身份、#7 工作区互斥 MVP 落地 |
