# 工作面 UI 对照与简化方案

> 状态：**W-1 · W-2 · W-3 已落地**；下一迭代 **W-4**（缺陷行「有运行」+ 工作项执行记录折叠）  
> 范围：总览看板 · 待办 · 缺陷列表 · 任务管理（列表/看板/新建）  
> 对照：仓库内 `../multica` + [learn-from-multica.md](./learn-from-multica.md)  
> 目标：找**值得简化 / 轻量借鉴**的点；不大面积重做成 Multica。

会话区单独见 [task-session-ui.md](./task-session-ui.md)（P0–P3）。

---

## 总判断

| 结论 | 说明 |
| --- | --- |
| **不必整体重设计** | 四页心智已齐：看态势 → 处理人介入 → 管缺陷/工作项 → 跑任务。与 Multica「Issue 为主、Task 为跑次」方向一致，只是 harness 更偏执行。 |
| **最该做的是简化与去重** | 总览与待办/缺陷重叠；任务页「看板 + 列表 + 会话」三重；缺陷与总览的 AI 修复/工作项按钮重复。 |
| **向 Multica 学什么** | **注意力队列**（Inbox）、**工作单元挂运行**（Issue ⊃ Task）、列表密度与空态区分；**不学**侧栏结构、Board/Gantt/Saved views、常驻 Chat、Usage 分析首页。 |
| **默认入口可讨论** | Multica 个人落地是 Inbox；agent-desk 默认总览。本地单用户下「待办优先」更贴人机协作，总览可降级为轻脉冲或并入待办顶栏。 |

---

## 心智对照（一页读懂）

```
Multica:     Inbox(人) ──► Issue(事) ──► Task(一次跑，侧栏 Execution log)
agent-desk:  待办(人) ──► 缺陷/工作项(事) + 任务会话(跑，主舞台)
             总览 = 可点统计 +「需要你处理」单列（W-1 后不再做第二缺陷列表）
```

| 对象 | Multica | agent-desk | 建议 |
| --- | --- | --- | --- |
| 人要处理的事 | Inbox（主落地） | 待办 + 总览「需要你处理」 | 强化待办；总览只做注意力摘抄 |
| 持续工作 | Issue | WorkItem（弹窗）+ 缺陷行 | 保持；弹窗即轻量 Issue，勿另开重详情页 |
| 一次执行 | Task（挂在 Issue） | Task（任务管理主列表） | **保留任务页**——本地 harness 以跑为中心是合理差异 |
| 态势 | Usage / Agents working chip | 总览四格可点统计 | 总览已瘦身，勿做成 Usage |

---

## 分面对照

### 1. 总览看板 `dashboard`

| | Multica | agent-desk |
| --- | --- | --- |
| 定位 | **无**产品 Home；落地 Inbox；Usage 是成本分析 | 四格可点统计 +「需要你处理」单列（闸门/验收） |
| 数据 | — | `GET /api/dashboard`：计数 + awaiting/in_review；**不再**返回 `open_issues` 列表 |
| 操作 | — | 统计跳转待办/任务/缺陷；列表仅「处理/验收」。**AI 修复 / 工作项只在缺陷表** |

**已落地（W-1）**

| # | 项 | 状态 |
| --- | --- | --- |
| D-1 | 瘦身总览：去掉开放缺陷大卡片与行内 AI 修复 | ✅ |
| B-1 | 缺陷操作入口去重：总览不重复 AI 修复/工作项 | ✅ |
| D-2 | 默认入口二选一 | 未做（可后置） |
| D-3 | 收 API：`active_tasks` / `failed_tasks` 仍返回未展示 | 归 **W-5** |
| D-4 | 不做 Usage / 多看板 | — |

---

### 2. 待办 `inbox`

| | Multica | agent-desk |
| --- | --- | --- |
| 定位 | 人注意力队列；主落地；master–detail | 闸门 `awaiting` + 工作项 `in_review`；卡片栈，点开进任务会话 |
| 交互 | 未读/归档、筛选、行内 live agent、详情复用 Issue | 闸门 chips / 验收；Reject 用备注弹层（非 `prompt`） |
| 密度 | ~58px 行；过滤空 ≠ 真空 | 卡片较松；总览仅摘抄同数据 |

**已落地（W-3）**

| # | 项 | 状态 |
| --- | --- | --- |
| I-1 | 文案统一「待办」；空态「没有需要你确认的闸门或验收」 | ✅ |
| I-2 | Reject 备注弹层（待办 + 工作项弹窗共用） | ✅ |
| I-3 | 真无待办空态（并入 I-1） | ✅ |
| I-4 | 行密度 | 未做（可选） |
| I-5 | master–detail / 归档 | 暂缓 |

**已对齐得好**：#5 Inbox 心智正确；角标；进会话深链。不必改成 Multica 分栏重做。

**建议（后续）**

| # | 项 | 做法 | 优先级 |
| --- | --- | --- | --- |
| I-4 | **可选：行密度** | 卡片改紧凑行 | 低 |
| I-5 | **暂缓** | master–detail、归档/未读、Virtuoso | — |

---

### 3. 缺陷列表 `bugs` + 工作项弹窗

| | Multica | agent-desk |
| --- | --- | --- |
| 定位 | Issue 是主工作台（board/list/…） | GitHub 等 Issue 表 +「工作项」弹窗挂执行与讨论 |
| 运行 | Execution log 挂 Issue 侧栏 | 弹窗内任务列表 → 跳任务会话 |
| 视图 | board/list/table/swimlane | 单表 + 搜索/状态 |

**已对齐得好**：Issue ≠ Task（WorkItem MVP）；弹窗内执行记录 + 时间线。勿做成 Multica Issue 全页。

**建议**

| # | 项 | 做法 | 优先级 |
| --- | --- | --- | --- |
| B-1 | **去重操作入口** | 「AI 修复 / 工作项」只在缺陷表；总览仅数字跳转 | ✅ **W-1** |
| B-2 | **行上「有运行」提示** | 相关 task `running/awaiting` 时行内小点 | 中 · **W-4** |
| B-3 | **弹窗执行记录折叠** | 活跃置顶 / 历史折叠 | 中 · **W-4** |
| B-4 | **表格小清理** | 未展示标签列等 | 低 · **W-5** |
| B-5 | **不做** | Issue board / DnD / Saved views / Gantt | — |

---

### 4. 任务管理 `tasks-list` / `tasks-new`

| | Multica | agent-desk |
| --- | --- | --- |
| 定位 | **无**独立 Task 主列表；跑次挂 Issue | **主舞台**：列表 + 会话 + 新建 composer（看板已移除） |
| 看板 | Issue 按状态分列 | ~~Task 四列看板~~ → **已删除**；状态靠列表 filter |
| Filter | — | `全部` / `进行中`(created\|preparing\|queued\|running) / `待确认` / `失败` / `已完成` / `已停止` |

**已落地（W-2）**

| # | 项 | 状态 |
| --- | --- | --- |
| T-1 | 移除任务看板 | ✅ |
| T-2 | preparing 纳入「进行中」；旧 URL `running/created/queued` 映射到 `active` | ✅ |
| T-3 | 列表 filter 收敛为进行中聚合 | ✅ |
| T-4 | 新建保持独立页 | — |
| T-5 | 不做取消任务主列表 | — |

**差异化应保留**：本地 harness 以「一次跑」为中心看日志/闸门，任务页合理。会话优化已在 task-session-ui。

**建议（后续）**

| # | 项 | 做法 | 优先级 |
| --- | --- | --- | --- |
| T-4 | **新建保持独立页** | 不必改成 Multica Chat | — |
| T-5 | **不做** | 取消任务主列表 / 改成 Issue 看板 | — |

---

## 推荐落地顺序

```
W-1 总览瘦身 (D-1) + 缺陷入口去重 (B-1)     ✅
  → W-2 任务看板决策 (T-1) + preparing/进行中 filter (T-2/T-3)  ✅
  → W-3 待办唯一化文案 (I-1) + Reject 弹层 (I-2)  ✅
  → W-4 缺陷行「有运行」提示 (B-2) + 工作项执行记录折叠 (B-3)
  → W-5 API 收口 (D-3) + 表格小清理 (B-4)
```

可选后置：默认进待办 (D-2-B)、待办行密度 (I-4)。

每项原则：**改信息架构与重复入口，不换皮、不引入 Multica 导航/Board/Chat。**

---

## 刻意不做

- 侧栏改成 Multica：Inbox → Chat → Issues → …
- 总览做成 Usage / 成本排行
- 缺陷页上 Board / Swimlane / Saved views
- 取消「任务管理」主列表（与本地 harness 定位冲突）
- 待办上归档/未读/多工作区（单用户本地无必要）
- 为对齐而重写四页视觉皮肤

---

## 与现有文档关系

| 文档 | 关系 |
| --- | --- |
| [learn-from-multica.md](./learn-from-multica.md) | 能力清单 #1/#5；本文是其 **列表/导航工作面** 的 UI 简化补丁 |
| [task-session-ui.md](./task-session-ui.md) | 任务**会话**密度与交互；本文管会话外的列表与总览 |

---

## 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-09-03 | **W-3 落地**：待办文案统一；Reject 用备注弹层（待办/工作项共用）；Escape 可关 |
| 2026-09-03 | **W-2 落地**：移除任务看板；filter「进行中」聚合 created/preparing/queued/running；旧 URL 兼容映射 |
| 2026-09-03 | **W-1 落地**：总览改为可点统计 +「需要你处理」单列；去掉开放缺陷卡片与行内 AI 修复；dashboard 不再返回 `open_issues` |
| 2026-09-03 | 初稿：总览/待办/缺陷/任务 对照 Multica；简化优先的 W-1…W-5 顺序 |
