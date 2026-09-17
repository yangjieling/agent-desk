# 异构 Agent 编排总体设计

**版本：** v0.3  
**状态：** Draft（愿景 + 对照）；**实现归属：agent-desk**  
**说明：** 文中若出现 hb-cli，视为既有产品对照，不以 hb-cli 子目录存放本文。  
**相关文档：**
- 当前产品：`产品说明.md` / 仓库 `README.md`
- 已落地切片：`executor-handoff-design.md`（跨基座执行者切换）
- 未落地切片：`task-state-control-design.md`（宿主状态机真理）

---

## 0. 一句话原则

> **hb-cli 不造 Agent，而是编排 Agent。**  
> Agent Framework 负责「构建 Agent」，Agent Runtime 负责「运行 Agent」，hb-cli 负责「组织多个异构 Agent 协同完成任务」。

本文描述的是编排层的**目标架构**，不是当前已全部交付的产品形态。下文用「现状 / 目标」区分二者。

---

## 1. 问题：为什么需要编排层

单个 Coding Agent（Claude Code、Codex、JoyCode、Hermes、OpenClaw 等）已经能独立完成大量工作。复杂度再上去时，真正的问题变成：

> **如何让能力不同、实现不同、Session 互不相通的多个 Agent，共同完成一条连贯的任务？**

例如缺陷修复：

```text
分析 → 改代码 → Review → 再修 → 测试 → 收口
```

不必、也不该强迫一个 Runtime 包办全程。更合理的是：

```text
Claude / JoyCode  → 分析
Codex             → 改代码
Hermes            → Review
Claude            → 测试
```

中间需要一层：**注册谁能做、按什么流程做、上下文如何交接、失败如何恢复、人何时介入**。这就是 hb-cli 编排层要解决的事。

它**不是**下一个 LangChain，也**不是**下一个 Hermes。Framework / Runtime 已经很多；缺的是跨 Runtime 的协作控制面。

---

## 2. 现状 vs 愿景

### 2.1 今天的 hb-cli（工作台）

产品定位（见 `README.md`）：

> **Hiboos 本地研发工作台**：技能分发与落地、缺陷闭环、任务执行与流程编排，协同 JoyCode / Claude / Codex。

已具备、且与编排愿景直接相关的能力：

| 能力 | 现状要点 | 主要代码 / 文档 |
|------|----------|-----------------|
| 三 Runtime 调用 | JoyCode / Claude / Codex CLI 非交互执行 | `hb/agent_backend.py`、`hb/runner_*.py` |
| 智能体（persona） | 名称 + instructions + provider + skills + model | `hb/agents.py` |
| Task | 本地任务 JSON；status / session / skill / workflow 关联 | `hb/tasks.py` |
| Workflow | 系统/用户模板；shared / independent 模式 | `hb/workflows.py`、`hb/workflow_runner.py` |
| 共享上下文（结构化） | workflow `sharedContext` V1 对象（目标/结论/变更/下一步）注入后续 prompt | `packages/core/src/shared-context.ts` |
| Executor Handoff | awaiting 时跨基座切换；作废 session + briefing | `task_handoff.py`、`executor-handoff-design.md` |
| 人机闸门 | `awaiting` + reply / 京 ME | `runner_gates.py` |
| 调度 / 恢复 | 并发队列、同目录互斥、有限 session recovery | `scheduler.py`、`session_recovery.py` |
| 缺陷闭环 | Bug 拉取 → bug-fix 等 skill 流水线 | `bugs.py`、`auto_flow.py` |

**还没有（或仅有雏形）的目标能力：** Team、通用 Issue 根对象、Capability 级 Assignment Policy、结构化 Shared Task Context、Hermes/Cursor 等更多 Runtime、Runtime Adapter SDK、Issue 级 Trace 产品化。

### 2.2 目标中的 hb-cli（编排层）

在保留「本地工作台 + Skill 分发」的前提下，把编排语义做实：

```text
工作单元（Issue / Bug / Task）
  → Workflow（做什么）
  → Assignment（谁来做）
  → Runtime Adapter（怎么跑）
  → Session（Runtime 内部上下文，可隔离）
  → Shared Context + Handoff（跨 Agent 连续）
  → Trace / Recovery / Human Approval
```

一句话：

> **Agent 负责做事，Runtime 负责运行，hb-cli 负责组织谁在什么时候做什么、以及跨 Agent 如何接上。**

### 2.3 和 Multica / OpenClaw / Hermes 的关系

| 系统 | 角色 |
|------|------|
| **Multica** | 云端 human–agent 协作控制面：Issue 为共享记忆，Daemon 在机器上跑 CLI |
| **OpenClaw / Hermes（在 Multica 中）** | 与 Claude/Codex 平级的 **Runtime 适配器**，不是编排器 |
| **hb-cli（现状）** | 本地工作台：Skill + Bug + Task + 三 CLI |
| **hb-cli（本文目标）** | 本地优先的异构编排层；结构化 Workflow / Handoff 是差异点 |

可借鉴 Multica 的：

1. **工作单元 ≠ 一次执行**（Issue 未完成 ≠ Run/Task 进程结束）
2. **Session 隔离，共享的是工作上下文**（Issue 时间线 / 我们的 Task Context）
3. **统一 Backend 接口**，协议差异（stream-json / ACP / …）留在 Adapter 内
4. Hermes / OpenClaw 只作为可插拔 Runtime，不把 Team/Workflow 塞进某个 Runtime

不宜照搬的：多租户云看板作为唯一 UI、用评论 `@` 作为唯一交接方式（我们已有结构化 Handoff，应强化）、把 Hermes 当成多 Agent 框架。

---

## 3. 三层架构

```text
┌─────────────────────────────────────────────┐
│           Orchestration Layer（hb-cli）      │
│  Team / Issue / Workflow / Task             │
│  Assignment / Handoff / Context / Trace     │
│  Recovery / Human Approval                  │
└──────────────────────┬──────────────────────┘
                       │ Runtime Adapter
┌──────────────────────▼──────────────────────┐
│           Agent Runtime Layer               │
│  JoyCode / Claude Code / Codex              │
│  Hermes / OpenClaw / Cursor / Custom …      │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│           Model Layer                       │
│  Claude / GPT / Gemini / Qwen / …           │
└─────────────────────────────────────────────┘
```

### 3.1 边界：Framework / Runtime / 编排

| 层次 | 解决什么 | 例子 |
|------|----------|------|
| **Agent Framework** | 如何**构建**一个 Agent | LangChain、LangGraph、AgentScope、Deep Agents |
| **Agent Runtime / Product** | 如何让 Agent**真正跑起来** | Claude Code、Codex、JoyCode、Hermes、OpenClaw、Cursor |
| **hb-cli 编排** | 已有很多 Agent，如何**组织协同** | 本文 |

Hermes 路线偏「完整 Runtime（开箱即用）」；LangChain 路线偏「构建框架（灵活组合）」。二者抽象目标不同，hb-cli **不替代其中任何一层**，只站在 Runtime 之上。

### 3.2 能力归属

原则：

> **单 Agent 内部的问题交给 Agent Runtime。**  
> **跨 Agent 的问题交给 hb-cli。**

| 能力 | Agent Runtime | hb-cli |
|------|:-------------:|:------:|
| Agent Loop / LLM / Tool / Terminal / Browser | ✅ | ❌ |
| Agent Memory / Skills 执行 / MCP / 内部 Planning | ✅ | ❌ |
| Agent Session | ✅（实现） | 管理引用 / 切换时作废 |
| Issue / Team / Workflow / Task | ❌ | ✅ |
| Assignment / Agent Switch / Cross-Agent Handoff | ❌ | ✅ |
| Shared Task Context / Workflow Trace | ❌ | ✅ |
| Retry / Recovery（跨 Agent） | 部分（进程内） | ✅（编排策略） |
| Human Approval | 可支持 | Workflow / 任务层统一协调 |

---

## 4. 术语（避免与 Multica 等混淆）

| 本文用语 | 含义 | 注意 |
|----------|------|------|
| **Issue** | 用户要解决的问题（根对象）；现状可用 **Bug** 作为主特例 | 不等于一次 CLI 进程 |
| **Workflow** | 完成 Issue 的步骤图（做什么） | 不绑死某个具体 CLI |
| **Task** | Workflow 中的一个执行步骤 / 工作单元 | ≠ Multica 文档里常指的「一次 Run」 |
| **Run / Execution** | 某 Task 在某 Runtime 上的一次进程执行 | 可失败重试、可换 Agent 再跑 |
| **Agent** | 逻辑角色（谁负责这类工作） | ≠ 某一个 CLI 进程 |
| **Runtime / 基座** | 实际执行引擎（JoyCode/Claude/Codex/…） | Agent 可绑定 Runtime |
| **Session** | Runtime 内部一次对话/执行上下文 | **禁止**跨 Runtime 强行 resume |
| **Shared Context** | 跨 Agent 共享的任务真相 | 可与 Session 并存、生命周期更长 |
| **Handoff** | 上下文转移包 | ≠ Session 转移 |
| **Team** | Agent 的逻辑编制（分析/开发/评审/测试等） | 目标能力；现状无 |

---

## 5. 核心领域模型

```text
Team
 ├── Agent ──► Runtime
 └── （可选）默认 Workflow 模板

Issue（或 Bug）
 └── Workflow
       └── Task
             ├── Assignment → Agent → Runtime
             ├── Session（可多个、可作废）
             ├── Context（共享）
             ├── Handoff（进出）
             └── Events / Trace
```

### 5.1 Team（目标）

Agent 的编制单元，内部允许**完全不同的 Runtime**：

```text
Defect Repair Team
├── Analyst   → Claude / JoyCode
├── Developer → Codex
├── Reviewer  → Hermes
└── Tester    → Claude
```

现状：仅有「自定义智能体」绑定单一 provider，尚无 Team 实体。

### 5.2 Agent

描述 **Identity / Role / Capability / Skill / Policy / Runtime**，不描述 Agent Loop。

```yaml
agent:
  name: code-reviewer
  role: Code Reviewer
  capabilities: [code-review, bug-analysis]
  skills: [java-review, spring-review]
  runtime:
    type: hermes   # 目标；现状仅 joycode|claude|codex
```

现状字段更接近：`provider` + `instructions` + `skills` + `model`（见 `agents.py`）。

### 5.3 Runtime Adapter

统一生命周期，不关心各 CLI 内部如何实现 Memory / Tool：

```text
start(agent, task, context) → session
send(session, message)
observe(session) → events
stop(session)
```

现状：`agent_backend.get_backend(coding_agent)` 对 JoyCode/Claude/Codex 做了等价事；Hermes/OpenClaw/Cursor 尚未接入。协议差异（stream-json、ACP 等）应留在 Adapter 内——与 Multica `Backend` 思路一致。

### 5.4 Issue

执行过程的根对象：需求、上下文、Workflow、Tasks、Handoffs、Events、Result。

现状：缺陷场景以 **Bug** 为根；通用自由任务以 **Task** 为根。目标可先「Bug 实现 Issue 语义」，再泛化。

### 5.5 Workflow

描述**做什么**，不描述**谁做**。

不推荐：

```yaml
step:
  name: review
  agent: hermes
```

更合理：

```yaml
step:
  name: review
  capability: [code-review]
```

由 Assignment 决定落到哪个 Agent/Runtime。

现状：节点多为 skill + 可选 `agent_id`（尤其 independent 模式），仍是 skill 流水线；能力解耦可渐进。

### 5.6 Task 与 Run

- **Task**：编排视角的步骤（分析 / 修改 / Review…），有状态、assignment、context。
- **Run**：该 Task 在某一 Runtime 上的一次实际执行。

**Run 结束 ≠ Issue/Task 业务完成**（对齐 Multica 的 Issue ≠ Run）。失败可 Retry、换 Agent、或等人。

### 5.7 Shared Task Context

跨 Agent 协作的核心。Session 可以隔离；**Context 必须可共享**。

建议逐步结构化（不必一次做完）：

```text
Original Requirement / Current Goal / Current State
Analysis / Decisions / Changed Files
Test Results / Errors / Agent Outputs
Completed Steps / Next Steps
```

现状：workflow 级 **SharedContextV1**（goal / conclusions / changedFiles / nextSteps 等）+ handoff briefing 文本（可附带共享上下文）。目标：继续强化可版本化、可展示、可注入的 Context 对象。

### 5.8 Session

每次切换 Runtime，Session 可以完全不同：

```text
Issue / Task
 ├── Claude Session A
 ├── Codex Session B
 └── Hermes Session C
```

hb-cli **不**强制跨 Runtime 共用 Session。已落地行为见 `executor-handoff-design.md`：切换时清空 `session_id`，注入交接包后开新会话。

### 5.9 Handoff

Agent A 的产出 → 转为 Agent B 可消费的上下文（摘要、结论、决策、变更文件、下一步），写入 Shared Context，再启动 B。

**Handoff = 上下文转移，不是 Session 转移。**

现状：`pending_handoff_briefing` 已在 awaiting 跨基座切换时落地。

### 5.10 Assignment（目标）

简单模式：步骤直接指定 Agent。  
高级模式：Capability → 候选 Agent → Policy（技能、Runtime、成本、负载、历史成功率）→ 选定。

现状：人工选择 `coding_agent` / `agent_id` / 节点 `agent_id`。

### 5.11 Skill

可复用专业能力（`java-debug`、`code-review`…），**不**强绑某个 Agent；同一 Skill 可被多个 Runtime 携带执行。

现状：Skill 已是一等公民（分发、落地、注入 prompt/脚本路径），比文档早期设想更超前——编排层应继续以 Skill 为步骤内容单位。

---

## 6. Orchestrator 职责

```text
Issue 创建 → Workflow 启动 → Task 创建/调度
→ Assignment → Runtime 启动 → Session 管理
→ Event 监听 → Context 更新 → Handoff / Agent Switch
→ Retry / Recovery → Human Approval → Result 汇总
```

现状拆分在 `workflow_runner`、`runner_exec`、`scheduler`、`task_handoff`、闸门与 Web/CLI 中，尚无单一 Orchestrator 模块；演进时可收敛，但**不必**为了对称而重写。

### 6.1 事件与 Trace

执行过程事件化（IssueCreated、TaskAssigned、AgentSwitched、HandoffCreated、TaskFailed…），用于日志、审计、UI、恢复、统计。

现状：任务级 `.log` + `.events.jsonl`。目标：能按 Issue/Workflow 串起「谁、何时、哪 Runtime、做了什么、为何切换、结果如何」。

### 6.2 Human-in-the-Loop

敏感步骤进入等待确认（提交、删文件、生产操作等），再 APPROVED / REJECTED / EDITED / CANCELLED。

现状：闸门 + `awaiting` + reply；宿主状态机的强化见 `task-state-control-design.md`（未落地）。

### 6.3 Retry 与 Recovery

Agent 失败 ≠ Task/Issue 失败。策略可包括：同 Agent 重试、换 Agent、人工介入。

现状：进程级 retry / idle timeout / 有限 session recovery；跨 Agent 恢复策略仍薄。

---

## 7. 端到端示例（缺陷修复）

```text
用户：修复订单支付超时
  → Issue/Bug #1001
  → Defect Repair Workflow

Task 分析   → Analyst → Claude Session A → Handoff #1 → 更新 Context
Task 修改   → Developer → Codex Session B
Task Review → Reviewer → Hermes Session C → Handoff #2
Task 再修   → Codex Session D
Task 测试   → Claude Session E
  → Workflow Completed → Issue Result
```

今天可用三 CLI + workflow + handoff **近似**跑通「串起来」；Team / Capability Assignment / Hermes / 结构化 Context 仍是演进项。

---

## 8. 系统结构（目标示意）

```text
CLI / Web / Automation / 京 ME
            │
            ▼
     Orchestrator（逻辑收敛）
     ├── Workflow
     ├── Assignment
     ├── Context Manager
     └── Handoff
            │
     Runtime Adapter
     ├── joycode / claude / codex   ← 已有
     ├── hermes / openclaw / …      ← 目标
     └── custom
            │
         Session（各 Runtime 隔离）
```

代码演进建议：在现有 `hb/` 包上扩展 `runtime/`（Adapter）、强化 `context/` / `handoff/`，而不是平行再建一套「平台」。若引入更清晰分层，可采用 domain / application / infrastructure，但以**少破坏现有 Task/Workflow 数据**为前提。

---

## 9. 分阶段路线（相对现状）

### Phase 0 — 已基本具备（巩固）

- 三 Runtime Adapter（JoyCode / Claude / Codex）
- Task + Workflow（skill 流水线）
- Executor Handoff（awaiting 跨基座）
- 闸门 / 调度 / 缺陷闭环 / Skill 分发

重点：**产品化已有编排切片**（handoff 可发现性、workflow 上下文可读性、事件时间线），而不是从零宣称「平台」。

### Phase 1 — 编排语义做实

- 明确 **Issue（先用 Bug）≠ Run**
- Shared Context 从字符串升级为可展示结构（至少：目标、结论、变更文件、下一步）
- Handoff 与 Context 写入统一模型（不仅切换执行者时有 briefing）
- 推进 `task-state-control-design.md`：宿主为状态真理
- Trace：按 Bug/Workflow 聚合任务事件

验收标准：同一缺陷流程上，**换基座续跑**与**多 skill 顺序执行**都走同一套 Context/Handoff，用户能看懂「交了什么、下一步谁做」。

### Phase 2 — Team 与 Assignment

- Team（角色编制）
- Capability / Skill 与步骤解耦
- Assignment Policy（先规则，后策略）
- 跨 Agent Retry（失败换人）
- Workflow 级 Human Approval 策略

### Phase 3 — Runtime 扩展

- Hermes、OpenClaw、Cursor 等 Adapter（协议差异关在 Adapter 内）
- 可选 Runtime Adapter 约定 / SDK，便于 Custom / Remote

### Phase 4 — 从缺陷到通用工作单元

缺陷修复、Review、SQL 分析、巡检、依赖升级、文档生成等，统一落在 Issue → Workflow → Task → Agent 抽象上；CLI 可演进为本地 **Agent Control Plane** 的入口之一（Web/API 并存），但仍以本地执行为主。

---

## 10. 核心设计原则（必须遵守）

1. **不重复造 Agent** — 优先复用 Claude / Codex / JoyCode / Hermes / OpenClaw 等 Runtime。  
2. **Agent ≠ Runtime** — 角色与执行引擎解耦。  
3. **Session 不跨 Runtime 强行共享** — 切换即新会话（已落地）。  
4. **Context 跨 Agent 共享** — 协作靠 Context + Handoff，不靠假统一 Session。  
5. **Workflow 描述做什么；Assignment 决定谁做；Runtime 决定怎么跑。**  
6. **跨 Agent 能力属于 hb-cli** — Switch、Handoff、Shared Context、Assignment、Recovery、Trace。  
7. **本地优先** — 可借鉴 Multica 控制面思想，不默认做成云端多租户看板。  
8. **演进贴着现状** — 新抽象要能映射到现有 Task / Workflow / Bug / Handoff，避免平行世界。

---

## 11. 核心竞争力（该比什么、不该比什么）

| 不要和谁比 | 比什么 |
|------------|--------|
| Claude / Codex / Hermes：谁写代码更好、谁 Agent 能力更多 | 如何把不同 Agent **组织起来**完成复杂任务 |
| LangChain：谁 Framework 更强 | 异构 Runtime 之上的协作与交接 |

差异化清单：Heterogeneous Runtime、Adapter、Team、Workflow、Assignment、Agent Switch、Shared Context、Handoff、Trace、Recovery、HITL、本地 Skill/缺陷闭环。

---

## 12. 产品定义（目标口径）

> **hb-cli 是面向异构 Agent Runtime 的编排层（本地优先）。**  
> 它不重新实现 Agent，而是通过 Workflow、Task、Assignment、Shared Context、Handoff、Agent Switch、Trace 与 Recovery，把 JoyCode、Claude Code、Codex、Hermes 以及其他 Runtime 组织起来，使多个 Agent 能协同完成复杂任务；同时继续承担 Skill 分发与缺陷等研发工作台职责。

**最终愿景一句话：**

> Agent 负责执行，hb-cli 负责协作。

---

## 附录 A. 类比（辅助理解，非实现约束）

**应用层 vs ORM：** LangChain/Hermes 像各种数据访问方案；hb-cli 更像应用/编排层，不替代 ORM。

**Control Plane 思想（非照搬 K8s）：** 控制层声明目标、调度、状态与生命周期，不关心 Pod/容器（此处即 Agent Runtime）内部如何实现。可用「Deployment≈Workflow、Pod≈一次 Agent 执行、Container Runtime≈Agent Runtime」帮助沟通，**不要**据此引入完整 K8s 概念税。

---

## 附录 B. 文档关系

| 文档 | 角色 |
|------|------|
| 本文 `multi-agent-orchestration-design.md` | 编排层总体愿景与边界 |
| `executor-handoff-design.md` | 已落地的跨基座 Switch / Handoff |
| `task-state-control-design.md` | 宿主状态机（未落地） |
| `产品说明.md` | 当前工作台产品说明 |
