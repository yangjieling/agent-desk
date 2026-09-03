# 任务运行界面 UI 优化方案

> 状态：**P0 已落地**（P1 部分完成：流式占位 / 失败条 / 步骤高亮；P2 未做）  
> 范围：任务列表分屏 + 右侧「任务会话」面板（`view-tasks-list` / `sessionPanel`）  
> 目标：提升运行中可读性与等待态体验，强化 harness 差异化（闸门 + 执行日志），不照搬 Multica 布局。

---

## 背景

当前任务页采用 **左列表 + 右会话** 分屏（`task-split.session-open`）。会话区已有时间轴、闸门卡片、底部活动条、回复框等能力，但在「任务刚启动、尚无输出」阶段体验偏弱：

- 中间大面积「暂无输出，等待 Agent 开始…」
- 底部同时出现「Agent 正在思考…」活动条
- 标题区 meta chips 较多，与底部状态重复
- 「连接中…」与「已运行 Ns」并存时，用户难以判断是页面断流还是任务卡住

本文档记录评审结论与分阶段落地方案，供后续迭代参考。

---

## 设计原则

| 原则 | 说明 |
| --- | --- |
| **执行感知优先** | 用户打开会话，首要问题是「在干什么、还要等多久、要不要我点」 |
| **轻量 harness** | 不引入 Multica 式 Issue 详情页复杂度；闸门与日志仍是核心 |
| **状态不重复** | 同一信息（运行中、Agent、连接态）只在一处主展示 |
| **分屏友好** | 会话打开后左侧列表可收窄，把宽度让给执行区 |
| **渐进增强** | P0 只改文案与布局；P1/P2 再动数据与交互 |

---

## 当前结构（代码锚点）

### 页面与布局

| 区域 | 文件 | 关键节点 |
| --- | --- | --- |
| 任务分屏 | `packages/ui/public/index.html` | `#taskSplit`, `.task-pane-list`, `.task-pane-session` |
| 会话面板 | 同上 | `#sessionPanel`, `#logScroll`, `#logTimeline`, `#logThinking`, `#replyBox` |
| 样式 | `packages/ui/public/app.css` | `.task-split.session-open`, `.log-thinking`, `.log-meta-chip`, `.log-empty` |
| 渲染逻辑 | `packages/ui/public/app.js` | `renderLogMeta`, `renderLogTimeline`, `updateLogActivityFooter`, `updateReplyComposerState` |

### 关键行为（现状）

1. **空时间轴**：`renderLogTimeline` 在无条目时渲染居中 `log-empty`（「暂无输出，等待 Agent 开始…」）。
2. **活动条**：`updateLogActivityFooter` 在 `running` 时显示 `#logThinking`，含已运行秒数、实时/连接中、无新输出提示。
3. **Meta chips**：`renderLogMeta` 堆叠状态、技能、工作流、Issue、Agent、模型、工作区、重试、失败码等。
4. **回复框**：`updateReplyComposerState` 在 `running` 时隐藏 `#replyBox`（合理）；`awaiting` 时显示闸门回复区。

### 已知问题对照

| 现象 | 根因 |
| --- | --- |
| 空屏 + 底部思考条并存 | `log-empty` 与 `logThinking` 独立判断，运行初期两者同时可见 |
| Meta 区信息噪音 | `renderLogMeta` 平铺所有字段，无主次 |
| 「连接中」令人不安 | `LOG_SSE_OPEN === false` 即显示连接中，未区分首连与断线重连 |
| 活动条在 scroll 内 | `#logThinking` 位于 `#logScroll` 子节点，随内容滚动，不像固定状态栏 |

---

## 目标信息架构

```
┌─ 标题 + 精简 meta（状态 · Agent · 工作区）──── [停止] [原始] [×] ─┐
├─ 工作流步骤条（workflow 任务时常显）────────────────────────────────┤
├─ 闸门卡片（awaiting 时）────────────────────────────────────────────┤
│                                                                      │
│  时间轴 / 流式输出区（flex:1，可滚动）                                │
│                                                                      │
├─ 固定活动条：● Agent 正在思考 · 已运行 14s · 实时 ──────────────────┤
└─ 回复框（awaiting / 可继续时显示）──────────────────────────────────┘
```

**心智模型**：上看上下文 → 中间看执行 → 下看要不要人介入。

---

## 优化项（分阶段）

### P0 — 小改动、体感提升大（建议首个迭代）

| # | 项 | 做法 | 涉及 |
| --- | --- | --- | --- |
| P0-1 | **合并等待态** | `running` 且无时间轴内容时：不渲染 `log-empty`；仅显示活动条，或改为居中的「启动中」卡片（含 Agent 名、工作区、已运行时长） | `renderLogTimeline`, `updateLogActivityFooter` |
| P0-2 | **固定底部活动条** | 将 `#logThinking` 移出 `#logScroll`，作为 `session-panel` 的 sticky footer（在 `#replyBox` 上方） | `index.html`, `app.css` |
| P0-3 | **精简 meta chips** | 首行保留：`状态` + `Agent` + `工作区`；其余收入「详情 ▾」或 tooltip | `renderLogMeta`, 可选新增 `#logMetaMore` |
| P0-4 | **连接状态分级** | 首 3s：`正在连接…`；SSE 正常：`实时`（绿）；断流 >5s：`连接中断，任务可能仍在运行` + 可选「刷新」 | `updateLogActivityFooter`, SSE 回调处更新 `LOG_SSE_OPEN` 时间戳 |

**验收标准**

- 运行中任务打开会话，不再出现「空屏 + 底部条」双重等待态
- 滚动长日志时，活动条始终贴底可见
- 标题区 chips ≤ 3 个主标签（其余可展开）
- 连接文案不与「已运行 10s+」产生矛盾感

---

### P1 — 运行中可读性

| # | 项 | 做法 | 涉及 |
| --- | --- | --- | --- |
| P1-1 | **活动流前置** | CLI 启动、读 prompt、等待首 token 前，插入 `activity` 节点（复用 `.log-activity`） | runner 事件或 `timelineForDisplay` 解析 |
| P1-2 | **流式占位** | 收到首条 assistant 前显示脉冲条/骨架，替代空白 | `renderLogTimeline` streaming 分支 |
| P1-3 | **工作流步骤常显** | workflow 任务将 `#logWfSteps` 固定在标题下，当前步骤高亮 | 已有 `logWfSteps`，调整显示条件与样式 |
| P1-4 | **失败/停止态** | 失败时活动条改为错误摘要 + 「重试」快捷入口（若 `autoRetry` 关闭） | `renderLogTask`, `FAILURE_CODE_LABEL` |

---

### P2 — 布局与导航

| # | 项 | 做法 | 涉及 |
| --- | --- | --- | --- |
| P2-1 | **分屏时收窄左侧** | `session-open` 时 filters 收成下拉；列表行只保留标题 + 状态点 + 关键操作 | `task-filters`, `renderTaskList` |
| P2-2 | **选中态加强** | 已有 `.task-row.selected` 左侧色条，与会话标题联动高亮 | `openLog`, CSS |
| P2-3 | **操作按钮语义化** | 停止/继续保留图标，宽屏时显示文字标签 | `session-head`, `log-head-actions` |
| P2-4 | **空会话引导** | 未选中任务时右侧显示「选择左侧任务查看执行」而非空白 | `task-pane-session` 空态 |

---

## 刻意不做（本阶段）

- 不做 Multica 式 Issue 详情 / 评论侧栏（属 #1 / #11 对象模型范畴，另文档规划）
- 不做完整聊天 UI（输入框常驻、气泡左右分列）—— 闸门回复框仅在需要时出现
- 不做 Token/费用面板（属 learn-from-multica #8，独立项）
- 不为对齐 Multica 改整体侧栏导航

---

## 与 Multica 学习清单的关系

| Multica 能力 | 本 UI 文档 | 说明 |
| --- | --- | --- |
| #5 Inbox / 待办 | 弱相关 | 待办页聚合 `awaiting`；会话区专注单任务执行 |
| #8 执行可观测性 | P1 部分重叠 | 工具时间轴已有；用量统计另做 |
| #11 评论时间线 | 不做 | 等工作项模型 #1 落地后再设计共享讨论流 |
| UI 信息架构（learn-from-multica §UI） | **遵循** | 能力驱动改布局，不必照搬 Multica 菜单 |

**建议节奏**：Multica 学习继续推进 **#1 Issue ≠ Task** 或 **#11 评论流**；本 UI 文档作为 harness 体验债，在对象模型稳定前可独立做 P0。

---

## 实现备忘

### 建议改动文件（P0）

```
packages/ui/public/index.html   # 移动 #logThinking  DOM 位置
packages/ui/public/app.css      # session-footer、meta 折叠、空态样式
packages/ui/public/app.js       # renderLogTimeline / updateLogActivityFooter / renderLogMeta
```

### `renderLogTimeline` 伪逻辑（P0-1）

```js
// running 且无条目：return（不渲染 log-empty），由 updateLogActivityFooter 承担等待态
if (!list.length) {
  if (LOG_TASK_STATUS === "running") {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = '<div class="log-empty">暂无输出…</div>';
  return;
}
```

### 连接状态分级（P0-4）建议

| 条件 | 文案 |
| --- | --- |
| `running` 且 SSE 未开 < 3s | `正在连接…` |
| SSE 已开 | `实时` |
| SSE 断开且 `staleSec` < 8s | `重新连接…` |
| SSE 断开且 `staleSec` ≥ 8s | `连接中断，任务可能仍在运行` |

---

## 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-09-02 | **P0 落地** + P1 部分：合并等待态、固定活动条、meta 折叠、连接分级；流式占位 / 失败条重试 / 步骤高亮；断流 ≥8s 可「刷新连接」 |
| 2026-09-02 | 初稿：任务会话 UI 评审结论与 P0–P2 方案 |
