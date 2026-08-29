---
version: 1.0.0
name: api-selftest
description: "coding-impl 编码完成（全部任务 completed，或轻量通道代码写完）后触发，提示是否对本次改动做接口自测；或用户说「接口自测」「自测一下」「跑一遍接口」「api-selftest」时触发。"
---


## hb-cli 运行适配

由 `hb` 任务或系统流程编排调用时遵守以下适配,优先级高于下文 JoyCode/Harness 专用门禁:

1. **不要**因缺少 `~/.harness/scripts/report-skill-usage.sh` 而中止;改用与其它 hb skill 相同的使用量上报 curl(若失败不阻塞)。
2. **不要**因「上下文隔离门禁」要求 `/clear` 或新窗口而停止执行;在当前 hb 任务会话内继续。
3. 项目级 `.harness/skills/<本技能>/SKILL.md` 不存在时,直接使用本文件。
4. Harness 规则文件若路径不存在,改读本技能目录下 `references/`(含 `references/rules/`)。
5. 本步只完成本技能职责,不要自行进入流程中的后续 skill;闸门确认后给出本步总结并结束本轮。

# 接口自测桥接 Skill（API Self-Test Bridge）

## 本 skill 是什么

一个**薄桥接**：编码完成后主动询问用户是否做接口自测，用户同意就**探测插件是否就位**并把控制权交给自测闭环（`/api-selftest` 命令 + 7 个专职 agent 的多 Agent 闭环）。

**本 skill 不重实现自测闭环、不改业务代码、不下测试结论**——真正的「验收设计→用例生成→启动/探活→测试→质量监督→修复→重测→Code Review」全由闭环里的 agent（`acceptance-designer` / `test-author` / `launcher` / `tester` / `ui-tester` / `test-auditor` / `fixer`）承担。桥接只做四件事：**问一句、定范围、探插件、转交（或引导安装）**。

> **运行方式（重要）**：自测闭环是**插件能力**,采用统一的插件市场机制,**不区分宿主/CLI/IDE**——JoyCode CLI、Claude Code、IDE 插件下都可用,只要 `api-selftest@hb-plugins` 已安装。故本 skill 在转交前**探测插件是否就位**(Step 3.1):就位才转交,未安装则给出安装命令引导、绝不静默失败。
>
> 为什么是桥接而不是复制：`api-selftest` 是一套独立维护的插件（自带 MCP、配置 schema、模板）。harness 只在主流程里开一个入口引导它，避免把插件整套 fork 进来造成双份维护。

## 推荐上下文

> 解析与跳过规则见 `rules/skill-conventions.md` §一（`.harness/` 优先，缺失跳过不阻塞）。

优先读取:
1. 当前需求的变更目录 `.harness/changes/{变更目录}/README.md` — 确认任务是否已 `completed`、本次改了什么
2. 当前需求的 `design.html` — 提取改动清单中涉及的接口 / 对外契约，作为自测范围
3. 当前需求的 `spec.html` — 提取验收标准，作为自测判定的业务预期

按需读取:
- `.harness/changes/{变更目录}/task-*.md` — 定位本次改动涉及的具体接口

## 定位

开发流程中位于**编码完成之后**，作为可选（默认推荐）的运行时验证环节：

```
编码实现 (coding-impl)
    ↓ 编码完成即提示 ← 本 skill 的触发点
接口自测 (api-selftest) ← 本 skill（桥接到插件闭环）
    ↓ 自测通过
提测报告 (test-report)
```

区别于编码自检：编码阶段的 lint / compile / 单测是**静态+单元**级别；本环节是**运行时接口自测**——真实起服务、打真接口、查库核对数据、自动修复重测，更重，因此在编码完成后**按需触发、不强制**。

## 触发时机

| 场景 | 触发方式 |
|------|---------|
| coding-impl 全部任务 `completed`（或 feature-lite / quick-change 代码写完） | coding-impl 完成总结后自动引导（见下方执行流程） |
| 用户主动触发 | 「接口自测」「自测一下」「跑一遍接口」「api-selftest」 |

---

## 执行流程

```
Step 1：确认改动范围
    ↓
Step 2：询问用户是否现在自测
    ├─ 否 → Step 4（跳过，给后续入口）
    └─ 是 ↓
Step 3：探测插件是否就位
    ├─ 就位（命令 / Agent 可解析） → 转交闭环（命令优先，退化用 Agent 编排）
    └─ 未安装 → 给安装命令引导（Claude 用 /plugin、JoyCode 用 /plugins，不阻塞）
    ↓
Step 4：回到主流程
```

### Step 1：确认改动范围（scope）

按优先级确定「本次自测哪些接口」：

1. **用户已显式指定**接口 / PRD / 接口文档 → 用指定的。
2. 否则从**当前变更目录**推导：读 `README.md` 确认任务状态与改动，读 `design.html` 改动清单提取本次新增/修改的接口，读涉及的 `task-*.md`。
3. 变更目录也没有（如零散改动）→ 简要向用户确认本次要测哪些接口，不要猜。

产出一句话范围描述，例如：`本次改动涉及 POST /order/create、PUT /order/{id}/cancel 两个接口`，作为 Step 3 传给插件的输入。

### Step 2：询问用户是否现在自测

用 AskUserQuestion 问一句（**这是本 skill 的核心动作，不要跳过**）：

> 「本次改动已编码完成，是否现在做接口自测？（启动服务 → 打真实接口 → 查库核对 → 自动修复重测，全自动跑到通过）」

选项：
- **是（推荐）** → 进入 Step 3。
- **否，稍后手动** → 进入 Step 4。

### Step 3：探测插件是否就位 → 转交

用户选「是」后，**先探测 api-selftest 插件是否就位**（插件是统一的市场机制,不分宿主/CLI/IDE,只看装没装），再决定走哪条路：

#### 3.1 探测（命中即停，不区分宿主）

| 探测项 | 判定 | 结论 |
|--------|------|------|
| ① `/api-selftest` 命令可解析 | 能 | 进 3.2 转交（命令路） |
| ② 自测 Agent 可调用（`acceptance-designer` / `tester` / `launcher` / `test-author` / `test-auditor` / `fixer` 出现在可调用 agent type 列表中） | 能（且 ① 不能时） | 进 3.2 转交（Agent 编排路） |
| ③ 以上都不满足 → **插件未安装** | — | 进「插件未安装时的引导」，给安装命令，**不阻塞主流程** |

#### 3.2 转交（插件就位）

1. **优先走命令**：`/api-selftest` 可解析 → 调用它，把 Step 1 得到的**接口范围**作为参数传入，由插件总控编排多 Agent 闭环（配置缺失时插件自行调用 `selftest-init` 补齐）。
2. **命令不可解析但 Agent 可调用**（探测项 ① 未命中、② 命中）→ 直接用 Agent 工具按闭环顺序编排:`acceptance-designer`(验收清单) → `test-author`(用例落地) → `launcher`(起服务/探活) → `tester`(打接口+查库) → `test-auditor`(质量监督) → `fixer`(修复) → 回 `launcher` 重测,直到通过或卡点。范围与判定基准来自 Step 1 + spec.html。
3. **前端轨道说明**：UI 自测 Agent(`ui-tester`)若未随插件就位,不影响后端接口自测。本次改动**仅后端接口** → 不受影响;涉及前端页面自测且 `ui-tester` 不可用 → 告知"前端自测轨道当前不可用,仅执行后端接口自测",不阻塞。
4. **等待产出**：跑完给出自测报告（接口执行台账 + 覆盖矩阵）与最终结论（通过 / 卡点），如实转达用户。

> 桥接只负责「探测插件 + 把用户和范围交给闭环」。闭环内部的环境闸口、循环熔断、质量红线由插件/Agent 自身守，本 skill 不复述、不覆盖。

### Step 4：回到主流程

- **自测通过** → 提示可进入 `test-report`（提测报告，自测报告正好作为提测证据），再到 `release-checklist`。
- **用户跳过 / 自测卡点** → 如实说明，提示后续可随时 `/api-selftest` 重跑，或直接进入 `test-report`。不因跳过自测而阻塞主流程。

---

## 插件未安装时的引导（探测项 ③）

自测闭环由 `api-selftest@hb-plugins` 插件提供。若探测发现命令与 Agent 都不可解析（插件未安装）：

1. **不阻塞、不报错终止**：明确告知用户「未检测到 api-selftest 插件（含 7 个测试 agent 与 mysql-mcp），已跳过自动接口自测」。
2. **给安装命令**（插件市场机制,不分场景;命令前缀按工具区分:Claude Code 用 `/plugin`,JoyCode 用 `/plugins`）：

   **Claude Code**:
   ```
   /plugin marketplace add git@coding.jd.com:fanshuqing1/hb-plugins.git
   /plugin install api-selftest@hb-plugins
   ```

   **JoyCode**:
   ```
   /plugins marketplace add git@coding.jd.com:fanshuqing1/hb-plugins.git
   /plugins install api-selftest@hb-plugins
   ```
3. **给恢复路径**：装完后重新 `/api-selftest` 即可进入闭环;暂不安装则继续走编码自检 + `test-report` 常规路径,并可基于 Step 1 的接口范围列一份手动验证项(起服务/打关键接口/核对 DB)兜底。

---

## 本 skill 不做什么

- **不重实现自测闭环**：验收设计 / 用例生成 / 起服务 / 打接口 / 查库 / 修复 / 重测全部委托插件，桥接不复制这些逻辑。
- **不改业务代码、不下测试/修复结论**：这些是插件里 `fixer` / `tester` / `test-auditor` 的职责。
- **不处理插件配置**：`env.local.yaml` / `selftest.local.yaml` / `db.local.yaml` 等由插件的 `selftest-init` 负责，桥接不碰。
- **不改任务状态**：不更新 task 文件或 README.md 的状态字段。

## 流程关系

```
需求分析 (request-analysis)
    ↓ spec.html confirmed
技术方案设计 (tech-design)
    ↓ design.html confirmed
任务拆分 (task-breakdown)
    ↓ tasks
编码实现 (coding-impl)
    ↓ 编码完成即提示是否自测
接口自测 (api-selftest)  ← 本 skill（桥接到插件多 Agent 闭环，可选默认推荐）
    ↓ 自测通过
提测报告 (test-report)
    ↓ test-report
上线检查 (release-checklist)
```
