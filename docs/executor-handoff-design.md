# 跨会话切换执行者（Executor Handoff）设计与技术说明

> **实现归属：agent-desk**（按本文落地）。文中 hb-cli 路径为既有对照/参考实现。  
> 状态：设计已在 hb-cli 侧有参考落地；agent-desk 按本文规则实现  
> 范围：任务处于 `awaiting` 时，在各编码 Agent 之间切换，并在新会话中继续闸门流程  
> 相关参考：`hb/task_handoff.py`、`hb/runner_exec.py` 等（对照用）

---

## 1. 为什么要做

Coding CLI（Claude Code / Codex / JoyCode）的 **session / thread 互不相通**：A 基座里谈过的上下文，无法 `resume` 到 B 基座。

但产品需要：

- 同一条任务、同一条时间线（log + events）连续推进；
- 用户在闸门等待时换执行者（例如 JoyCode 0-token 空跑 → 切 Claude/Codex）；
- 换人后仍能认当前闸门、用户确认意图，并继续 bug-fix 后续步骤。

因此采用 **「作废旧会话 + 浓缩交接包 + 新会话续跑」**，而不是假装跨 CLI resume。

---

## 2. 设计原则

| 原则 | 含义 |
|---|---|
| 时间线保留 | `.log` / `.events.jsonl` 不截断、不换任务 ID |
| 会话作废 | 切换时清空 `session_id`；跨基座不可 resume |
| 交接一次性 | `pending_handoff_briefing` 注入新会话；有实质进展后再消费 |
| 发送时提交 | UI 选执行者只是草稿；点「发送」才调 API 写交接 |
| 确认即行动 | 交接后的确认类回复必须调工具执行，禁止只口头规划 |
| 空跑可重试 | 0-token / 半截 turn 保留 briefing，清掉空 session，便于再发 |

---

## 3. 核心概念

### 3.1 执行者（Executor）

二选一（与新建任务一致）：

- **基座 CLI**：`coding_agent` ∈ `{joycode, claude, codex}`，`agent_id=""`
- **智能体**：`agent_id` 非空，实际 provider 取自智能体配置的 `provider`

### 3.2 会话（Session）

- 存于 `tasks/<id>.json` 的 `session_id`
- 由各 CLI 在 stream 事件里回写（Claude/Codex/JoyCode 各自格式）
- **同基座**且有 `session_id` → `resume_task` 走 resume 命令
- **切换执行者后** → `session_id=""`，下轮走 fresh continue

### 3.3 交接包（Handoff Briefing）

字段：`pending_handoff_briefing`（任务 JSON 内长文本，上限约 5000 字）

内容结构（生成于 `build_handoff_briefing`）：

1. 角色说明：新执行者、旧会话不可继续  
2. 元信息：上一任/本任、标题、skill、缺陷号、当前待确认闸门名  
3. 原始目标摘要  
4. 近期闸门 / 用户回复 / 上一任末段输出（来自 events 尾部）  
5. 【下一任行动】清单（确认闸门、开下一闸门、禁止空回复等）

过滤：编排侧噪声（「未开闸门/未收口」「强制停在本闸门」等）不进入闸门摘要，避免误导下一任。

---

## 4. 状态机与数据流

```text
                    ┌─────────────────────────────────────────┐
                    │  awaiting + 非 running                   │
                    │  用户在回复区选新执行者（本地草稿）        │
                    └─────────────────┬───────────────────────┘
                                      │ 发送
                                      ▼
                    POST /api/tasks/executor
                    switch_executor():
                      - 校验 awaiting / 目标就绪
                      - session_id = ""
                      - pending_handoff_briefing = 交接包
                      - 换基座时 coding_model 清空
                                      │
                                      ▼
                    POST /api/tasks/reply  (用户回复 / 闸门选项)
                    resume_task():
                      session_id? ──有──► _resume_worker
                           │
                           └─无 + 有 handoff──► _fresh_continue_worker
                                      │
                                      ▼
                    组装 prompt =
                      身份 + skill pack + 【执行器交接】+ 【确认指令?】+ 用户回复
                    新开会话 exec（非 resume）
                                      │
                    ┌─────────────────┴─────────────────┐
                    │ 有实质进展？                         │
                    ├─ 是 → consume_handoff_briefing     │
                    └─ 否 → 保留 briefing，清空 session   │
                            （可再次发送重试）              │
```

### 4.1 `resume_task` 分支（关键）

```text
有 session_id          → resume 旧会话
无 session_id + handoff → fresh continue（注入交接）
二者皆无               → 报错：无法继续
```

---

## 5. API 与落盘

### 5.1 `POST /api/tasks/executor`

请求：

```json
{ "id": "t_…", "coding_agent": "codex", "agent_id": "" }
```

或智能体：

```json
{ "id": "t_…", "agent_id": "a_…", "coding_agent": "" }
```

约束：

- 仅 `status == awaiting` 且本任务未在跑  
- 目标 backend `require_ready()`  
- 流程步骤任务会解析到 step task id（与 reply 一致）

成功副作用：

- 更新 `agent_id` / `coding_agent` / `session_id=""` / `pending_handoff_briefing`  
- 日志写入 `[handoff] 执行者已切换: A → B…`  
- 返回 `pending_handoff: true`、展示用 label、解析后的模型等  

### 5.2 任务字段

| 字段 | 作用 |
|---|---|
| `coding_agent` | 当前基座 |
| `agent_id` | 智能体（可空） |
| `session_id` | 当前 CLI 会话；切换时清空 |
| `pending_handoff_briefing` | 待注入交接包；消费后清空 |
| `coding_model` | 换基座时清空，避免把 A 的模型名带给 B |

### 5.3 可观测性

日志标签：

- `[handoff] 执行者已切换…`
- `[handoff] 已注入交接说明并开启新会话`
- `[handoff] 交接续跑无实质进展,已保留交接说明…`
- `[auto-nudge] 检测到半截 turn,自动催促…`

Events：`handoff` 映射为 `status` kind，时间线显示「交接」。

---

## 6. 前端交互

位置：任务日志弹窗回复区。

| 行为 | 说明 |
|---|---|
| Runner chip + popover / `@` | 本地草稿，设 `LOG_EXECUTOR_DIRTY` |
| 轮询刷新 | dirty 时不覆盖草稿执行者 |
| 发送 | `ensureReplyExecutorCommitted()` → 若 dirty 先 `POST /executor`，再 reply |
| 无确认弹窗 | 选中即草稿，发送即生效 |
| Placeholder | dirty / pending_handoff 时提示「发送后将开启新会话并注入交接」 |
| 模型下拉 | 跟随草稿基座拉模型列表；缓存减少屏闪；占位符 `<模型名>` 已过滤 |

设计取舍：**不在选择当下写交接**，避免用户点着玩就作废当前 session；与「发送才提交」一致。

---

## 7. 新会话 Prompt 组装

`_build_fresh_continue_prompt`：

```text
[智能体身份指令?]
[skill pack 全文?]
【执行器交接】
  <pending_handoff_briefing>
【确认指令】          ← 仅当用户回复像闸门确认
  禁止再开同一闸门；必须立刻执行动作（可调工具）；禁止只规划
【用户本轮回复】
  <reply>
[+ 京 ME / hb-choices 规则]
```

确认类判定（`_is_gate_confirm_reply`）覆盖：

- `确认` / `确认无误` / `确认推送` / `确认提交` / `checkout_direct` / `1|2|3` 等  
- 以及以「确认」「继续」开头的选项值  

这是修复「切 Codex 后回确认推送却只口头规划」的关键约束。

---

## 8. 空跑与半截 turn 治理

交接后常见失败模式：

| 现象 | 原因 | 处理 |
|---|---|---|
| tokens=0, tools=0 | JoyCode 官方模型列表不可用等 | awaiting 提示换执行器；noop → 保留 briefing |
| 只说「我会去 push」就结束 | 模型规划 turn、未调工具 | `_looks_like_premature_stop` → awaiting；可 `schedule_premature_nudge` 催一轮 |
| 闸门确认收口被当成 premature | 文案含「继续/下一步」 | 收口语义（视为通过/根因已确认等）排除误判 |

### 8.1 `_fresh_continue_noop`

判定「本轮无实质进展」时：

1. 保留 `pending_handoff_briefing`  
2. `session_id=""`（丢掉空/半截会话）  
3. 用户再次发送 → 再次 fresh continue + 注入同一份交接  

口头规划（日志含「未开闸门/未收口即结束」）也视为 noop，避免「说了一句计划」就消费掉交接包。

### 8.2 自动催促（auto-nudge）

- 触发：premature awaiting（非 0-token）  
- 动作：worker 退出后自动 resume 一条强约束催促文案  
- 限制：**每任务仅一次**，防止死循环  

---

## 9. 与「同会话 resume」的对比

| | 同基座续聊 | 跨执行者交接 |
|---|---|---|
| 入口 | `resume_task` + `session_id` | `switch_executor` + 无 session + handoff |
| Prompt | 短回复 + skill 提醒 | 完整身份 + skill + 交接包 + 确认指令 |
| 上下文 | CLI 侧会话记忆 | 仅交接包 + 仓库事实 + 本轮回复 |
| 时间线 | 同一 task 追加 | 同一 task 追加（含 handoff 日志） |

---

## 10. 已知限制与运维建议

1. **交接不是无损记忆**：超长对话会被 clip；下一任以交接 + 仓库为准。  
2. **JoyCode 0-token**：交接机制正常，但基座本身调不起模型时需换 Claude/Codex。  
3. **模型名跨基座不通用**：切换基座清空 `coding_model`，避免把 `GLM-5.3` 传给 Codex。  
4. **智能体指令**：fresh continue 会重新注入身份前缀；依赖「会话里早已说过」的隐性约定不可靠。  
5. **流程步骤**：切换作用在 step task；UI 传入父任务 ID 时由 web 层 resolve。  

---

## 11. 测试要点

| 用例 | 期望 |
|---|---|
| awaiting 下 Claude → Codex | session 清空、briefing 写入、日志有 handoff |
| 发送「确认推送」 | prompt 含【确认指令】与禁止只规划 |
| JoyCode tokens=0 | briefing 保留，可再次发送或再切换 |
| 闸门收口长文 + tools=0 | 不误判 premature（有「视为通过」等） |
| 口头规划半截 turn | premature +（可选）一次 auto-nudge |
| UI dirty 时轮询 | 不冲掉草稿执行者 |

自动化：`tests/test_task_handoff.py`、`tests/test_runner_gates.py`。

---

## 12. 模块职责一览

```text
app.js              草稿 / 发送时 commit / 模型同步
web.py              POST /api/tasks/executor
task_handoff.py     生成 briefing、switch、consume
tasks.py            pending_handoff_briefing 字段落盘
runner_exec.py      resume vs fresh_continue、noop 判定
runner_prompt.py    fresh prompt、确认指令
runner_gates.py     premature 判定、auto-nudge
runner_events.py    handoff 标签进时间线
```

---

## 13. 小结

跨会话换 Agent 的本质不是「迁移 session」，而是：

> **保留人类可读的任务时间线，用一份浓缩交接说明在新 CLI 会话里冷启动，并用确认指令 / 空跑重试 / 半截催促，把闸门流程接回去。**

该能力让 hb-cli 在多基座并存、偶发 0-token 的现实约束下，仍能把同一条 bug-fix（或其它 skill）跑完，而无需用户重建任务或手工复述上下文。
