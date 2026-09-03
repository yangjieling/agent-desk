# 任务运行界面 UI 优化方案

> 状态：**P0–P2 已落地**；**P1-1 活动流前置已补齐**；下一迭代做 **P3 转录密度**（按序实现，见下）  
> 范围：任务列表分屏 + 右侧「任务会话」面板（`view-tasks-list` / `sessionPanel`）  
> 目标：提升运行中可读性与等待态体验，强化 harness 差异化（闸门 + 执行日志），不照搬 Multica 布局。

---

## 背景

任务页采用 **左列表 + 右会话** 分屏（`task-split.session-open`）。P0–P2 已解决运行初期双重等待态、活动条随滚动消失、meta 噪音、连接文案焦虑，以及分屏收窄 / 空态引导等问题。

本文档记录评审结论、已落地项与后续补丁条目，供另一任务按序实现。

---

## 设计原则

| 原则 | 说明 |
| --- | --- |
| **执行感知优先** | 用户打开会话，首要问题是「在干什么、还要等多久、要不要我点」 |
| **轻量 harness** | 不引入 Multica 式 Issue 详情页复杂度；闸门与日志仍是核心 |
| **状态不重复** | 同一信息（运行中、Agent、连接态）只在一处主展示 |
| **分屏友好** | 会话打开后左侧列表可收窄，把宽度让给执行区 |
| **渐进增强** | 先文案与布局，再密度与扫读；不换皮、不改成 Chat |

---

## 当前结构（代码锚点）

### 页面与布局

| 区域 | 文件 | 关键节点 |
| --- | --- | --- |
| 任务分屏 | `packages/ui/public/index.html` | `#taskSplit`, `.task-pane-list`, `.task-pane-session`, `#sessionEmpty` |
| 会话面板 | 同上 | `#sessionPanel`, `#logScroll`, `#logTimeline`, `#logSessionFooter` / `#logThinking`, `#replyBox` |
| 样式 | `packages/ui/public/app.css` | `.task-split.session-open`, `.log-session-footer`, `.log-item`, `.session-empty` |
| 渲染逻辑 | `packages/ui/public/app.js` | `renderLogMeta`, `renderLogTimeline`, `updateLogActivityFooter`, `updateReplyComposerState` |
| 时间轴解析 | `packages/ui/public/log-timeline.js` | `activity` / `tool` 条目 |

### 关键行为（P0–P2 后）

1. **空时间轴**：`running` 且无条目时不渲染 `log-empty`，等待态由 sticky `#logSessionFooter` 承担；`queued`/`created` 有轻量空态文案。
2. **活动条**：固定在回复框上方；含已运行秒数、连接分级（实时 / 重连 / 中断）、失败条「重试」、断流 ≥8s「刷新连接」。
3. **Meta chips**：主行状态 · Agent · 工作区；其余收入「详情 ▾」。
4. **回复框**：`running` 时隐藏；`awaiting` / 可继续时显示闸门回复区。
5. **分屏**：常驻左右栏；打开会话后 filters → `#taskFilterSelect`，列表行收窄；未选任务显示 `#sessionEmpty`。
6. **启动活动流**：进入 `running` 即写入 runtime/prompt/cli activity；首 token 前底部与时间轴同步显示「启动… / 等待首条回复」。

---

## 目标信息架构

```
┌─ 标题 + 精简 meta（状态 · Agent · 工作区）──── [停止] [原始] [×] ─┐
├─ （P3）终态摘要条（done / failed / stopped）──────────────────────┤
├─ 工作流步骤条（workflow 任务时常显）────────────────────────────────┤
├─ 闸门卡片（awaiting 时）────────────────────────────────────────────┤
│                                                                      │
│  时间轴：assistant 卡片 · tool/activity 扁行 · 可选分组/过滤         │
│                                                                      │
├─ 固定活动条：● Agent 正在思考 · 已运行 14s · 实时 ──────────────────┤
└─ 回复框（awaiting / 可继续时显示）──────────────────────────────────┘
```

**心智模型**：上看上下文 → 中间看执行 → 下看要不要人介入。

---

## 优化项（分阶段）

### P0 — 等待态与状态表达 ✅

| # | 项 | 状态 | 备注 |
| --- | --- | --- | --- |
| P0-1 | 合并等待态 | ✅ | `running` 空时间轴不渲染 `log-empty` |
| P0-2 | 固定底部活动条 | ✅ | `#logThinking` → `#logSessionFooter` |
| P0-3 | 精简 meta chips | ✅ | 主行 +「详情 ▾」 |
| P0-4 | 连接状态分级 | ✅ | 首连 / 实时 / 重连 / 中断 +「刷新连接」 |

### P1 — 运行中可读性 ✅

| # | 项 | 状态 | 备注 |
| --- | --- | --- | --- |
| P1-1 | 活动流前置 | ✅ | spawn 前写入 activity JSON（runtime/prompt/cli）；解析 `$` / `[workspace]`；首 token 前补「等待首条回复」 |
| P1-2 | 流式占位 | ✅ | `.log-stream-pulse`；有 running activity 时优先活动行 |
| P1-3 | 工作流步骤常显 + 当前高亮 | ✅ | `#logWfSteps` + `.current` |
| P1-4 | 失败/停止态 + 重试 | ✅ | 活动条错误摘要 +「重试」/「继续」 |

### P2 — 布局与导航 ✅

| # | 项 | 状态 | 备注 |
| --- | --- | --- | --- |
| P2-1 | 分屏收窄左侧 | ✅ | `taskFilterSelect` + 紧凑行 |
| P2-2 | 选中态加强 | ✅ | 色条 + `#sessionPanel.is-active-session` |
| P2-3 | 操作按钮语义化 | ✅ | 宽屏图标 + 文字标签 |
| P2-4 | 空会话引导 | ✅ | `#sessionEmpty` |

---

### P3 — 转录密度（下一迭代 · 按序实现）

> 对照 Multica **transcript / execution-log 的小交互**，不学其 Issue 布局、Chat 常驻输入、RunTimeline 双车道、Virtuoso。  
> 实现时只动 `packages/ui/public/{app.css,app.js,index.html}`（必要时 `log-timeline.js`）；每项单独可验收、可回滚。

#### 建议落地顺序

```
P3-1 → P3-2 → P3-3 →（可选）P3-4 →（可选）P3-5 →（有投诉再做）P3-6
```

| # | 项 | 做法 | 涉及 | 验收 |
| --- | --- | --- | --- | --- |
| **P3-1** | **工具行扁化** | `.log-item.tool` 默认一行：工具名 + 可选短摘要；去掉厚暖色卡片感（浅底或无边框即可）。`details` 仍承载参数/输出，默认折叠。assistant / user / gate 保持现有卡片。 | `renderLogTimeline` tool 分支, `app.css` | 长工具序列时时间轴以扁行扫读，展开才占高 |
| **P3-2** | **assistant 正文密度** | `.log-md` 标题继续降到 body 字重/字号；段间距略收（贴近 Multica `transcript-prose` 的 data-panel 节奏，不是文章页）。不改 markdown 解析器能力。 | `app.css` `.log-md*` | 助手长回复更紧、仍可读 |
| **P3-3** | **终态摘要条** | `done` / `failed` / `stopped` 时，在时间轴顶部（或活动条位置）显示一行结果：成功简述 / 失败码+文案 / 已停止。失败码复用 `FAILURE_CODE_LABEL`；有用量 chip 时可附带一行（可选，不阻塞）。`running`/`awaiting` 不显示。 | `renderLogTask` / `updateLogActivityFooter` 或新 `#logOutcome`, `app.css` | 打开已结束任务，一眼看到结果再滚日志 |
| **P3-4** | **连续 tool 折叠**（可选） | 相邻 `type===tool` 折叠为一条「N 次工具调用」分组行，点击展开为扁行列表。参考 Multica `groupSteps` 思路，手写轻量即可，不引入组件库。 | `renderLogTimeline` 或 `timelineForDisplay` 预处理 | 工具连打时默认折叠；展开后行为同 P3-1 |
| **P3-5** | **轻量视图过滤**（可选） | 会话头或时间轴顶增加分段：`全部` / `仅助手` / `仅工具`（三态足够）。不做 Multica 式按工具种类多选 filter。过滤只影响展示，不改 `LOG_RESULT`。 | `index.html` + `renderLogTimeline` | 长运行可快速只看助手结论 |
| **P3-6** | **跟滚抗抖动**（投诉驱动） | 现有 `nearBottom` 48px。仅当流式时出现「用户上滚仍被拽回」再加强：略增阈值，或记录用户上滚意图后暂停自动贴底直至回到底部。不移植 Multica stick-to-bottom 全套 latch。 | `app.js` scroll helpers | 上滚阅读历史时不被流式输出打断 |

#### P3 刻意不做

- Multica Transcript 弹层替代右侧会话
- RunTimeline 双车道 / 缩放时间轴
- Newest-first 翻转排序（会话时间轴保持正序）
- Virtuoso / 虚拟列表（日志量未证明需要前不做）
- 常驻 Chat 输入框、气泡左右分列
- 换 shadcn / design token 皮肤

#### P3 建议改动文件

```
packages/ui/public/app.css      # tool 扁行、log-md 间距、outcome 条
packages/ui/public/app.js       # renderLogTimeline / outcome / group / filter / scroll
packages/ui/public/index.html   # 可选：#logOutcome、过滤分段控件
packages/ui/public/log-timeline.js  # 仅当分组需要稳定 tool id/时长时再动
```

---

## 刻意不做（全局）

- 不做 Multica 式 Issue 详情 / 评论侧栏（属 #1 / #11 对象模型范畴，另文档规划）
- 不做完整聊天 UI（输入框常驻、气泡左右分列）—— 闸门回复框仅在需要时出现
- 不做 Token/费用面板（属 learn-from-multica #8，独立项）
- 不为对齐 Multica 改整体侧栏导航或视觉换皮
- 「工作项下多次执行折叠列表」跟对象模型走，不塞进本会话面板的 P3

---

## 与 Multica 学习清单的关系

| Multica 能力 | 本 UI 文档 | 说明 |
| --- | --- | --- |
| #5 Inbox / 待办 | 弱相关 | 待办页聚合 `awaiting`；会话区专注单任务执行 |
| #8 执行可观测性 | P1 已有日志；P3 加强扫读 | 用量汇总仍另做 |
| #11 评论时间线 | 不做 | 工作项模型另规划 |
| Transcript 交互细节 | **P3 轻量吸收** | 密度 / 终态 / 可选分组过滤；不抄布局 |
| UI 信息架构（learn-from-multica §UI） | **遵循** | 能力驱动改布局，不必照搬 Multica 菜单 |

**建议节奏**：另一任务按 **P3-1 → P3-3** 先落地必做项；P3-4/5 视长任务痛感；P3-6 有投诉再做。对象模型继续跟 learn-from-multica #1 / #11。

---

## 实现备忘（历史 · P0）

### 连接状态分级（P0-4，已落地）

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
| 2026-09-03 | **P1-1 落地**：spawn 前写入启动 activity；解析 activity / `$` / workspace；等待首 token 时显示活动行 |
| 2026-09-03 | 对齐 P0–P2 已落地现状；新增 **P3 转录密度** 按序补丁条目（工具扁化 → 正文密度 → 终态摘要 → 可选分组/过滤/跟滚） |
| 2026-09-03 | **P2 落地**：常驻分栏 + 空态引导；会话打开收窄列表/筛选下拉/状态点；选中态与会话头联动；操作按钮宽屏文字标签 |
| 2026-09-02 | **P0 落地** + P1 部分：合并等待态、固定活动条、meta 折叠、连接分级；流式占位 / 失败条重试 / 步骤高亮；断流 ≥8s 可「刷新连接」 |
| 2026-09-02 | 初稿：任务会话 UI 评审结论与 P0–P2 方案 |
