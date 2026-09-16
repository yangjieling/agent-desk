# 任务状态控制（Task State Control）设计说明

> **实现归属：agent-desk**。文中 hb-cli 为对照现状。  
> 状态：**设计稿**（按 agent-desk 仓库规范择机落地）  
> 范围：任务生命周期中的 `running` / `awaiting` / `done` / `stopped` 判定、闸门与收口协议  
> 对照参考：`hb/runner_exec.py`、`hb/runner_gates.py` 等  
> 关联设计：`docs/executor-handoff-design.md`（跨基座交接）

---

## 1. 背景与问题

hb-cli 把 Coding CLI（JoyCode / Claude / Codex）当作「执行器」，自己维护任务状态与人机闸门：

| 状态 | 含义（现状） |
|------|----------------|
| `running` | 子进程执行中 |
| `awaiting` | 等人确认（闸门 / 半截 turn / 空跑） |
| `done` | 正常完成 |
| `stopped` | 用户终止 /「先不修」等 |
| `failed` | 异常失败 |

**痛点（已观测）：**

1. **模型差异大**：同一套注入规则下，JoyCode 常开「服务评价」，Claude 常直接交描述就 `done`，Codex 常自造「后续操作」闸门。  
2. **自然语言收口不可靠**：致谢里含「继续了解」会被误判为半截 turn；Codex 偶发 `usage=0` 但仍有正文，旧逻辑会强行 `awaiting`。  
3. **提示词既当协议又当文案**：`## 闸门`、`## hb-choices`、京 ME 规则全部塞进 prompt，依赖模型「自觉遵守」。  
4. **收口标记刚引入**：`## hb-task-end`（prompt 要求 + 宿主识别）方向正确，但仍是 markdown 约定，模型可不输出。

**目标：** 把「任务该停在哪」的**真理**收回到宿主状态机；模型只通过**结构化通道**表达意图（开闸门 / 结束 / 提问），prompt 仅作辅佐。

---

## 2. 设计原则

| 原则 | 含义 |
|------|------|
| 宿主为真理 | `status` 只由 hb 根据结构化信号改写，不靠散文情绪判断「做完了」 |
| 结构化优先 | 结束、开闸、选项优先走固定标记或 tool；markdown 为过渡兼容层 |
| Prompt 只教行为 | 告诉模型「何时打哪个标记 / 调哪个工具」，不把判定逻辑只放在模型侧 |
| 可演进 | 先强化标记协议，再可选升级为 tool；不一次拆掉现有闸门体验 |
| 与交接兼容 | 收口/闸门协议变更后，handoff briefing 仍能摘要「当前待确认闸门」 |

---

## 3. 业界对照（可学什么）

> 结论：成熟系统**不全靠提示词**；常见是「状态机在宿主 + 结构化通道表态」。

| 项目 | 机制 | 对 hb 的启示 |
|------|------|----------------|
| [OpenHands SDK](https://github.com/OpenHands/software-agent-sdk) | `WAITING_FOR_CONFIRMATION`；Finish tool + schema；风险确认暂停 | 结束用 **显式 finish**；确认用宿主暂停，不靠猜文案 |
| [PlanGate](https://github.com/s977043/PlanGate) | Plan / PR 级 Gate + hooks 强制 | 关键闸门可 hooks/校验，不单靠模型 |
| [TaskGate](https://github.com/kondi0/taskgate) | 原子步骤后等人发 continue/wait/redo/stop | 用户指令集固定，状态机清晰 |
| GitHub Copilot Coding Agent | PR / Actions **平台闸门** | 高风险动作用平台能力卡死 |
| LangGraph / AutoGen HITL | `interrupt` / human node | 图里显式暂停-恢复，与 CLI 解耦 |

**分层对照：**

```text
┌─────────────────────────────────────────┐
│  Prompt（教模型怎么表现）                 │  ← 辅
├─────────────────────────────────────────┤
│  结构化通道（标记 / tool / JSON）         │  ← 协议
├─────────────────────────────────────────┤
│  宿主状态机（running/awaiting/done…）     │  ← 真理
└─────────────────────────────────────────┘
```

---

## 4. 现状架构（As-Is）

### 4.1 完成判定（`runner_exec` 一轮结束后）

优先级大致为：

1. 用户 abort（「先不修」等）→ `stopped`  
2. **`## hb-task-end`** → `done`（已加）  
3. 像在提问 / 开闸门 → `awaiting` + 可选京 ME  
4. 空跑（无正文 + usage=0）或半截 progress → `awaiting`（premature）  
5. 否则 → `done`

### 4.2 协议表面（模型输出）

| 约定 | 用途 |
|------|------|
| `## 闸门「名称」` | 开确认闸门 |
| `## hb-choices` | Web 可点选项 |
| `## hb-task-end` | 用户结束意图 / 评价后收口 |
| 自然语言关键词 | 半截 turn、评价开/闭、abort 等兜底 |

### 4.3 Prompt 注入

`_build_prompt` / `_build_resume_prompt` 统一附加：

- 京 ME 规则（`_notify_link_rules`）  
- 闸门与 choices（`_gate_choice_rules`）  
- 任务收口（`_task_end_rules` → 要求输出 `## hb-task-end`）

各基座（JoyCode / Claude / Codex）**同一套**注入；差异来自模型遵守程度。

---

## 5. 目标架构（To-Be）

### 5.1 意图枚举（模型 → 宿主）

模型每轮结束时，宿主只认下列**显式意图**之一（可并存兼容旧 markdown）：

| Intent | 含义 | 宿主动作 |
|--------|------|----------|
| `open_gate` | 需要用户确认 | → `awaiting`，解析 choices，可选京 ME |
| `task_end` | 正常收口 | → `done` |
| `task_abort` | 放弃修复类终止 | → `stopped` |
| `continue_work` | 还应继续干（半截） | → `awaiting` + nudge（限次） |
| `plain_answer` | 自由回答且无闸门 | 策略见下（可配置） |

未识别意图时：走保守策略（prefer awaiting 或 prefer done，由设置控制），并打日志便于调参。

### 5.2 协议演进两阶段

#### Phase A — 强化标记协议（推荐先做，改动小）

1. **收口**  
   - 保留并强化 `## hb-task-end`（已部分落地）。  
   - 评价「好/还可以/差」后的 resume prompt 再次强调必须带标记。  
   - 用户选项含「结束」时，Web 文案可提示「结束后模型应输出收口标记」。

2. **闸门**  
   - 继续 `## 闸门` + `## hb-choices`。  
   - 禁止在同一轮既 `hb-task-end` 又开新闸门（宿主：`task_end` 优先）。

3. **半截 turn**  
   - 有正文时不得仅因 `usage=0` 判 premature（已修方向保留）。  
   - 收尾致谢关键词仅作**弱兜底**；有 `hb-task-end` 时关键词可废弃。

4. **自由任务默认策略（可配置）**  
   - 选项 A：描述类任务允许无闸门直接 `done`（贴近 Claude 现状）。  
   - 选项 B：无技能任务结束后由宿主**合成**服务评价闸门（不依赖模型）。  
   - 默认建议：A + 显式 `hb-task-end`；评价闸门仅 skill/流程任务强制。

#### Phase B — Tool / 结构化通道（可选，更稳）

在能拦截或包装各 CLI 工具链时：

| Tool（示意） | 参数 | 宿主效果 |
|--------------|------|----------|
| `hb_open_gate` | `name`, `body`, `choices[]` | 写 result、`awaiting`、京 ME |
| `hb_task_end` | `summary?` | `done` |
| `hb_task_abort` | `reason?` | `stopped` |

实现路径候选：

- **B1**：仅 JoyCode/Codex 若支持自定义 MCP/tool，注册 hb 本地 MCP。  
- **B2**：不改 CLI，继续解析 stdout 中的标记（Phase A），tool 作为文档化「虚拟协议」。  
- **B3**：自建薄代理：所有基座经 hb wrapper 跑，wrapper 提供伪 tool 并把调用转成状态变更。

推荐落地顺序：**A →（观察遵守率）→ 再评估 B1/B3**。

### 5.3 状态机（目标）

```text
                 create/run
                     │
                     ▼
                 running ◄──────────────────────────────┐
                     │                                  │
        ┌────────────┼────────────┬─────────────┐       │
        │            │            │             │       │
        ▼            ▼            ▼             ▼       │
     done      awaiting      stopped        failed      │
                   │                                    │
                   │ 用户 reply / 自动确认 / nudge       │
                   └────────────────────────────────────┘

awaiting 子类型（可记日志或字段，不必立刻入库）：
  - gate_confirm
  - service_rating
  - premature_nudge
  - zero_token_empty
```

**判定优先级（目标）：**

1. `task_abort` / 用户停止按钮  
2. `task_end`（`## hb-task-end` 或 finish tool）  
3. `open_gate`（含服务评价）  
4. `continue_work` / 空跑无正文  
5. `plain_answer` → 按策略 done 或合成评价闸门  

---

## 6. 与京 ME / 服务评价的关系

| 场景 | 建议行为 |
|------|----------|
| Skill / 流程任务开闸门 | 保持：`awaiting` +（若开启）京 ME |
| 用户明确结束 | `hb-task-end` → `done`，**不再**开服务评价、不发京 ME |
| 用户刚评价完 | 要求 `hb-task-end` → `done`，禁止再开「后续操作」 |
| 自由描述且未开闸门 | 默认直接 `done`；若产品要坚持评价，用**宿主合成闸门**，勿只靠 prompt |

原则：**京 ME 只绑定「真闸门 awaiting」**，不绑定「模型说了谢谢」。

---

## 7. 配置项（建议后期加 settings）

| Key | 默认 | 说明 |
|-----|------|------|
| `free_task_require_rating` | `false` | 无技能任务结束是否由宿主合成服务评价 |
| `strict_task_end_marker` | `false`（观察期）→ 可升 `true` | 无标记的收尾是否拒绝 done、强制 nudge 一次要标记 |
| `premature_nudge_max` | `1` | 每任务自动催促次数（已有「每任务一次」思路，可配置化） |

---

## 8. 实现分期

| 阶段 | 内容 | 验收 |
|------|------|------|
| **A0（已部分完成）** | `## hb-task-end` prompt + 宿主识别优先 done；usage=0 有正文不误判 | 单测 + Codex「结束」路径打标后 done |
| **A1** | resume/评价后再次强调标记；「结束」选项 value 与文案对齐；日志 `[done] hb-task-end` | 三基座各跑 1 次描述→结束 |
| **A2** | 自由任务评价策略可配置；弱化纯关键词 premature | 设置开关切换行为可测 |
| **B** | 评估 MCP/wrapper finish tool | 设计评审后再开 |

---

## 9. 测试要点

- `_looks_like_task_end`：独占行 / 夹杂正文 / 大小写。  
- `task_end` 优先于同轮误带的闸门文案。  
- 评价后致谢 **无** 标记：观察期可 done（弱兜底）或 nudge 要标记（strict）。  
- Codex `usage=0` + 有 assistant 正文 + `hb-task-end` → `done`。  
- 用户「结束」→ 模型输出标记 → 无第二次京 ME。  
- 回归：bug-fix 闸门链、handoff、自动确认闸门。

---

## 10. 非目标

- 不在本设计内统一三家 CLI 的原生 session 协议。  
- 不强制改写各 skill 的业务流程文案（仅统一收口/闸门宿主协议）。  
- 不把京 ME 改成「任务 done 也通知」（除非产品单独立项）。

---

## 11. 开放问题

1. 自由任务是否要默认服务评价？（建议默认否，可配置。）  
2. `strict_task_end_marker=true` 时，模型连续两次不打标如何收口？（建议第二次宿主强制 done + 日志告警。）  
3. Phase B 优先 MCP 还是 wrapper？（取决于各基座 tool 扩展成本。）  

---

## 12. 参考

- OpenHands confirmation / Finish tool：<https://docs.openhands.dev/>  
- PlanGate：<https://github.com/s977043/PlanGate>  
- TaskGate：<https://github.com/kondi0/taskgate>  
- 本仓库交接设计：`docs/executor-handoff-design.md`  
- 现状实现：`hb/runner_gates.py`（`TASK_END_MARKER`）、`hb/runner_prompt.py`（`_task_end_rules`）、`hb/runner_exec.py`（完成分支）
