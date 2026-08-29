---
version: 1.0.0
name: code-review
description: "审查当前代码变更时触发。Use when the user asks for code review、代码审查、review、PRD review、PRD 审查、需求审查、需求一致性核对、需求覆盖度检查、对照需求 review、按需求审查代码、比对 PRD 看改动、复核这次改动有没有把 PRD 做对，或显式提到 prd-code-review。"
metadata:
  short-description: 代码审查（可选 PRD 需求对照 + Wiki 业务知识库 + 定制化规范 + 团队规范 + 实现风险）
---


## hb-cli 运行适配

由 `hb` 任务或系统流程编排调用时遵守以下适配,优先级高于下文 JoyCode/Harness 专用门禁:

1. **不要**因缺少 `~/.harness/scripts/report-skill-usage.sh` 而中止;改用与其它 hb skill 相同的使用量上报 curl(若失败不阻塞)。
2. **不要**因「上下文隔离门禁」要求 `/clear` 或新窗口而停止执行;在当前 hb 任务会话内继续。
3. 项目级 `.harness/skills/<本技能>/SKILL.md` 不存在时,直接使用本文件。
4. Harness 规则文件若路径不存在,改读本技能目录下 `references/`(含 `references/rules/`)。
5. 本步只完成本技能职责,不要自行进入流程中的后续 skill;闸门确认后给出本步总结并结束本轮。

# Code Review Skill

本 skill 支持两种模式：提供 PRD 或人工修正后的 `requirement_list` 时执行「需求审查」；两者都未提供时执行「基础审查」。基础审查不做需求与代码的正向、反向比对，其余审查步骤保持不变。

**核心能力**：在所有审查步骤前，**强制**分析项目代码生成项目 Wiki 知识库（`docs/wiki/` 目录）和项目定制化规范文档（`customization.md`），并在审查阶段**必须严格参考 Wiki 内容**，以 Wiki 和 customization.md 为核心依据执行「历史逻辑影响校验」和「定制化规范合规性审查」。

## 启动前置：上下文隔离门禁 ★ 强制执行 ★

> **完成 Preamble（即 Step 0.0 使用量上报和项目级覆盖检查）后立即执行，必须在 Step 0.1 项目分析前完成。目标是获得等同新窗口或执行 `/clear` 后的干净上下文，而不是仅声明“忽略历史对话”。**

1. **判断上下文是否干净**：忽略系统指令、skill 内容和本次调用；若此前仍存在其他用户/AI 业务对话，则视为已有历史上下文。
2. **干净上下文**：直接进入 Step 0.1。
3. **已有历史上下文**：
   - 先保存本次调用原文及显式参数（`prd_path`、`requirement_list`、`base`、`include_worktree`、`output_dir`），生成一条可直接重放的 code-review 启动命令。
   - 若客户端提供可调用的上下文清理、新建窗口或隔离会话能力，并且清理后能够重放本次调用，则立即使用该能力并在干净上下文中重新进入本 skill。
   - 若客户端不支持自动清理，则**停止执行审查**，提示用户执行 `/clear`，并输出上一步生成的重放命令。用户重新发起前，不允许进入 Step 0.1。
4. **清理后的事实来源**：只允许使用重放后的本次调用、磁盘上的 PRD/需求清单、git diff 及本 skill 后续生成的文件；禁止复用清理前对话中的结论、代码片段或审查意见。

**禁止行为**：
- 禁止以“我会忽略之前的内容”代替真实的上下文清理或隔离
- 禁止清理上下文时丢失本次调用参数
- 禁止在上下文隔离完成前进入 Step 0.1，或生成 Wiki、需求清单、审查报告

---

## 输入参数

| 参数 | 必填 | 默认值 | 说明 |
|------|:----:|----|------|
| `prd_path` | 否 | — | PRD 文档路径（.md/.txt/.pdf）；传入后进入需求审查 |
| `requirement_list` | 否 | — | 已拆好的需求清单路径；传入后进入需求审查并跳过 PRD 解构 |
| `base` | 否 | 按链路自动解析 | git base 分支 |
| `include_worktree` | 否 | `true` | 是否纳入 staged+unstaged 改动 |
| `output_dir` | 否 | `docs/prd-review/` | 报告输出目录 |

`prd_path` 与 `requirement_list` 都不传 → 进入基础审查，不主动追问 PRD。

---

## 工作流总览

```
Step 0.0 使用量上报 ★ 强制执行 ★（最高优先级）
  ↓
上下文隔离门禁 ★ 强制执行 ★
  ↓  （已有历史上下文 → 清理/新建隔离会话后重放；无法自动清理 → 阻塞并提示 /clear）
Step 0 项目上下文生成 ★ 强制 ★（Wiki 知识库 + customization.md）
  ↓  （生成失败 → 阻塞，不进入后续步骤）
Step 1 输入校验与模式判定（含 Step 0 产物存在性强制校验）
  ↓
Step 2 获取需求清单（仅需求审查；基础审查跳过）
  ↓
Step 3 Diff 收集
  ↓
Step 4 多维审查
   4.1 正向扫描（需求 → 代码 四态，仅需求审查）
   4.2 反向扫描（代码 → 需求 超范围，仅需求审查）
   4.3 数据库变更扫描
   4.4 团队规范扫描
   4.5 历史逻辑影响校验 ★ 强制 ★（依据 Wiki 知识库）
   4.6 定制化规范合规性审查 ★ 强制 ★（依据 customization.md）
   4.7 实现风险扫描
   4.8 关键代码质量扫描
   4.9 多维去重与合并
  ↓
Step 5 产出报告：{output_dir}/review-{ts}.md
  ↓
Step 6 交互式确认与上报（询问用户是否采纳建议）
```

**全局契约**：

0. **Step 0.0 使用量上报是最高优先级的强制操作**：进入 skill 后必须首先执行使用量上报，完成后执行上下文隔离门禁；隔离通过后再进入 Step 0.1。此步骤不可跳过、不可延后。
1. **Step 0 是不可跳过的硬性关卡**：Wiki 知识库（`docs/wiki/` 目录下的 `abstract.md`、`business/` 目录、`tech.md`）和 `customization.md` 必须在 Step 1 校验前**已存在于磁盘上**。若 docs/wiki/ 下缺少任何文件，必须**先生成 Wiki，后执行审查**，绝不允许反过来或跳过。Step 4.5 和 Step 4.6 必须严格参考 Wiki 内容和 customization.md 进行审查，不允许跳过。
2. **需求审查先落盘，再继续**：需求审查模式下，Step 2 必须先把需求清单写入磁盘，才允许进入 Step 3；基础审查模式跳过 Step 2。
3. **需求审查的磁盘文件是唯一事实来源**：需求审查模式下，Step 3+ 的需求比对只从已落盘文件读取需求。
4. **最终产物必须完整**：两种模式都必须包含 Wiki 知识库（abstract.md + business/*.md + tech.md）、customization.md、review-{ts}.md；需求审查模式还必须包含 requirements-{ts}.md。

---

## Step 0：项目上下文生成 ★ 强制步骤 / 不可跳过 / 最高优先级 ★

### Step 0.0：使用量上报 ★ 强制执行 / 不可跳过 / 最高优先级 ★

> **本步骤是整个 skill 执行前的必要操作，必须在进入 Step 0.1 之前完成。**

**强制执行（进入 skill 后第一步）**：根据操作系统执行使用量上报，完成后再执行后续流程。

- **Windows**：运行 `"%USERPROFILE%\.harness\scripts\report-skill-usage.bat" "code-review"`
- **macOS/Linux**：运行 `bash "$HOME/.harness/scripts/report-skill-usage.sh" "code-review"`

**执行要求**：
- 本步骤不可跳过、不可延后
- 上报完成后必须先通过上下文隔离门禁，方可进入 Step 0.1
- 若上报失败，打印错误信息但不阻塞后续流程（允许继续执行审查）

### 强制执行流程（必须严格按顺序执行）

```
┌─────────────────────────────────────────────────────────────────────┐
│  Step 0.1  Wiki 知识库检查与生成                                      │
│                                                                      │
│  1. 检查 docs/wiki/abstract.md 是否存在                               │
│  2. 检查 docs/wiki/business/ 目录是否存在且包含至少 1 个 *.md 文件     │
│  3. 检查 docs/wiki/tech.md 是否存在                                   │
│                                                                      │
│  三项全部通过 → 打印复用提示，进入 Step 0.2                           │
│  任一项不通过 → ★ 立即执行 Wiki 生成 ★（见下方生成流程）              │
│                → 生成后重新检查三项，仍不通过 → 阻塞报错，终止 skill   │
├─────────────────────────────────────────────────────────────────────┤
│  Step 0.2  customization.md 检查与生成                                │
│                                                                      │
│  1. 检查 {output_dir}/customization.md 是否存在                       │
│                                                                      │
│  存在 → 打印复用提示，进入 Step 1                                     │
│  不存在 → ★ 立即执行 customization.md 生成 ★                          │
│         → 生成后检查文件存在性，不存在 → 阻塞报错，终止 skill          │
├─────────────────────────────────────────────────────────────────────┤
│  全部通过 → 打印 Step 0 完成提示 → 进入 Step 1                       │
│  任一失败 → ★ 阻塞，不允许进入 Step 1 ★                              │
└─────────────────────────────────────────────────────────────────────┘
```

**绝对禁止的行为**：
- 禁止跳过 Step 0 直接进入 Step 1 或更后面的步骤
- 禁止在 Wiki 文件不存在时"先做审查，后面再补 Wiki"
- 禁止在 customization.md 不存在时"先做审查，后面再补 customization"
- 禁止用"Wiki/customization 生成太耗时"为由跳过
- 禁止仅在内存中持有 Wiki 或 customization 内容而不落盘
- 禁止在 customization.md 缺失时执行 Step 4.6 定制化规范审查之外的任何降级处理（如"跳过本步"）

### 产出文件

| 文件 | 路径 | 用途 |
|------|------|------|
| 项目概述 | `docs/wiki/abstract.md` | 项目整体介绍，审查时用于理解项目背景 |
| 核心业务模块 | `docs/wiki/business/{业务名称}模块.md` | Step 4.5 判断代码变更是否影响历史业务逻辑的**必需依据** |
| 技术模块 | `docs/wiki/tech.md` | 技术架构参考，审查时用于判断架构合规性 |
| 定制化规范文档 | `{output_dir}/customization.md` | Step 4.6 审查代码是否符合项目规范的**必需依据** |

### 复用策略

**Wiki 知识库和 customization.md 是审查的必需依据，不允许跳过。**

- 若 `docs/wiki/` 目录已存在且**同时**包含 abstract.md、business/ 目录（含至少 1 个 .md 文件）、tech.md → 自动复用，不重新生成（打印复用提示）
- 若 `docs/wiki/` 目录不存在，或缺少上述任一文件 → **必须立即生成全部 Wiki 文件**
- 若 `{output_dir}/customization.md` 已存在 → 自动复用，不重新生成
- 若不存在 → **必须立即生成**，生成失败则阻塞整个 skill，不允许进入后续步骤
- 用户可手动编辑 Wiki 文件以补充/修正信息，后续 review 自动复用修正版

### 0.1 生成 Wiki 知识库（docs/wiki/ 目录）

> **触发条件**：docs/wiki/ 目录不存在，或缺少 abstract.md / business/*.md / tech.md 中的任一项。
> **此步骤一旦触发，必须完整生成全部三类文件后才能继续。**

通过分析项目现有代码，提取并归纳已实现的业务逻辑与技术架构，形成「Wiki 知识库」：

1. **扫描项目入口与核心模块**：Controller/API 层接口、Service 层业务方法、数据层模型、配置文件、技术组件
2. **按业务域分组**：识别项目中的独立业务模块，按模块拆分文档
3. **提取技术架构**：框架选型、分层设计、数据库设计、监控运维等

**Wiki 目录结构**：

```
docs/wiki/
├── abstract.md                     # 项目概述
├── business/                  # 核心业务模块目录
│   ├── {业务名称A}模块.md          # 各业务模块独立文件
│   ├── {业务名称B}模块.md
│   └── ...
└── tech.md                         # 技术模块
```

#### abstract.md（项目概述）

```markdown
# 项目概述（自动生成）
> 生成时间：YYYY-MM-DD HH:mm

## 项目简介
（项目名称、定位、核心价值）

## 模块总览
（各业务模块的简要列表与一句话描述）

## 技术栈概览
（主要技术栈的简要列表）

## 关键集成依赖
（外部系统集成的简要列表）
```

#### business/{业务名称}模块.md（核心业务模块）

根据项目中不同的业务内容，在 `business/` 目录下生成独立的业务文档，文件名格式为 `{业务名称}模块.md`。每个文件结构如下：

```markdown
# {业务名称}模块（自动生成）
> 生成时间：YYYY-MM-DD HH:mm

## 业务概述
（本模块的业务背景、定位、核心职责）

## 业务核心功能
### 功能1：{功能名}
- **接口**: `POST /api/v1/xxx`
- **核心逻辑**: 描述
- **业务规则**: 1. ... 2. ...
- **数据变更**: 涉及表 xxx
- **关键代码**: `com.xxx.Service:method`

### 功能2：{功能名}
（同上结构）

## 外部系统集成
| 集成系统 | 集成方式 | 用途 | 关键代码 |
|----------|----------|------|----------|
| xxx系统 | JSF/HTTP/MQ | 描述 | `XxxGateway` |
```

#### tech.md（技术模块）

```markdown
# 技术模块（自动生成）
> 生成时间：YYYY-MM-DD HH:mm

## 系统概述
（系统整体架构定位、部署形态）

## 架构设计理念
（分层思想、领域驱动、模块化等核心设计理念）

## 技术栈
| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 框架 | Spring Boot | x.x | 基础框架 |
| ... | ... | ... | ... |

## 架构演进历程
（重大架构变更的时间线和原因，从代码/配置中推断）

## 数据库架构设计
### 核心数据表
| 表名 | 用途 | 关键字段 | 所属模块 |
|------|------|----------|----------|
| xxx | 描述 | 字段列表 | 模块名 |

### 索引设计
（重要索引的说明）

## 监控和运维
（日志框架、监控打点、告警配置、定时任务等运维相关信息）
```

4. **落盘到 `docs/wiki/` 目录**，落盘失败则阻塞

5. **【落盘后强制验证】** 生成完成后必须逐一验证以下文件已写入磁盘：
    - `docs/wiki/abstract.md` 存在且非空
    - `docs/wiki/business/` 目录存在且包含至少 1 个 `.md` 文件
    - `docs/wiki/tech.md` 存在且非空
    - 任一项验证失败 → 阻塞报错，提示具体缺失文件，**不允许进入 Step 0.2**

6. **【终端确认】** 验证通过后打印：
   ```
   ✅ Wiki 知识库已生成
      abstract.md（项目概述）
      business/（{N} 个业务模块文件）
      tech.md（技术模块）
   ```

### 0.2 生成 customization.md ★ 强制 ★

> **触发条件**：`{output_dir}/customization.md` 不存在。
> **此步骤与 Step 0.1 Wiki 生成具有同等强制力，customization.md 是 Step 4.6 定制化规范审查的必需依据，缺失则整个 skill 阻塞。**

**必须严格按照 [`templates/customization-template.md`](templates/customization-template.md) 的结构生成**，不允许自行发挥章节结构。

通过分析项目代码，按模板九大章节逐一提取内容：

1. **项目类型**：从 pom.xml / 项目结构推断项目业务类型和服务形态
2. **核心技术栈**：从 pom.xml 依赖声明提取技术组件及版本
3. **项目分层结构**：扫描包目录和类命名后缀，识别分层约定和数据对象规范
4. **自定义开发规约**：统计多数代码的命名模式、注入方式、校验方式、工具类
5. **数据库规范**：从 DDL / Mapper XML / Entity 提取表名和字段命名模式、SQL 编写规范
6. **接口返回格式与错误码**：找统一 Result/Response 类和错误码枚举
7. **自定义异常体系**：扫描异常类继承树和全局异常处理器
8. **日志规范**：统计日志框架、日志级别使用模式、内容规范
9. **业务特有要求**：扫描幂等实现、分布式锁、并发控制、数据安全等模式

**生成原则**：
- 以项目中**多数代码的实际做法**为准，少数偏离视为历史债务
- 无法从代码推断的章节标注「待补充」但**不省略章节**
- 每个规则尽量附带项目中的实际代码示例

落盘到 `{output_dir}/customization.md`，落盘失败则阻塞。

**【落盘后强制验证】** 生成完成后必须验证：
- `{output_dir}/customization.md` 存在且非空
- 验证失败 → 阻塞报错，**不允许进入 Step 1**

**【终端确认】** 验证通过后打印：
```
✅ customization.md 已生成
   路径: {output_dir}/customization.md
   章节: 九大章节（项目类型/技术栈/分层/规约/DB/返回格式/异常/日志/业务要求）
```

### Step 0 终端提示

```
📚 项目上下文生成完成
   Wiki 知识库: docs/wiki/（{N} 个业务模块）{复用/新生成}
     - abstract.md（项目概述）
     - business/（{N} 个业务模块文件）
     - tech.md（技术模块）
   定制规范: {output_dir}/customization.md（{M} 项约定）{复用/新生成}
```

---

## Step 1：输入校验与模式判定

- 传入 `prd_path` 或 `requirement_list` → 校验对应文件存在，进入「需求审查」
- 两者都未传入 → 进入「基础审查」，不询问用户补充 PRD
- 当前在 git 仓库内
- 按链路解析 base 分支
- diff 非空
- **强制校验 Step 0 产物（第二道防线）**：
    1. `docs/wiki/abstract.md` 存在
    2. `docs/wiki/business/` 目录存在且包含至少 1 个 `.md` 文件
    3. `docs/wiki/tech.md` 存在
    4. `{output_dir}/customization.md` 存在
    - **以上四项任一不满足 → 立即阻塞报错**：打印缺失项，提示"Step 0 产物不完整，请确认 Wiki 知识库和 customization.md 已正确生成"。**绝对不允许在 Wiki 或 customization.md 缺失的情况下继续执行后续步骤。**
- 确定时间戳 `{ts}`，预创建输出目录

---

## Step 2：获取需求清单

> 本步骤仅适用于需求审查。基础审查直接跳过，不生成或复用 `requirements-{ts}.md`。

1. 显式传入 `requirement_list` → 直接采用
2. 否则解构 `prd_path` → 立即写盘 `requirements-{ts}.md`

---

## Step 3：Diff 收集

- 需求审查：按需求清单的关联表、关联文件提示加权排序，收集 diff
- 基础审查：直接收集完整 diff

---

## Step 4：多维审查

先按 Step 1 的模式判定执行：需求审查执行 4.1-4.9；基础审查跳过 4.1、4.2，直接执行 4.3-4.9。

### 4.1 正向扫描（需求 → 代码 四态，仅需求审查）

| 状态 | 含义 |
|------|------|
| ✅ 已实现 | 代码完整覆盖需求 |
| 🟡 部分实现 | 主体有了但缺字段/分支 |
| ❌ 未实现 | PRD 提到了但代码没做 |
| ⚠️ 偏离 | 代码做了但与 PRD 不一致 |

每条结论必须附 `file:line` + 代码片段。

### 4.2 反向扫描（代码 → 需求 超范围，仅需求审查）

找代码改了但没对应需求点的部分 → 标注 ➕ 超范围。

### 4.3 数据库变更扫描

读取 [`references/database-conventions.md`](references/database-conventions.md) 扫描 SQL/DDL/Mapper。

### 4.4 团队规范扫描

读取 [`references/team-style-guide.md`](references/team-style-guide.md) 逐条扫描违规。

### 4.5 历史逻辑影响校验 ★ 强制执行 ★

> **本步骤为强制执行，不允许跳过。** 必须读取 `docs/wiki/` 目录下的 Wiki 知识库（Step 0 已强制生成），**严格参考 Wiki 中各业务模块文档的内容**，以此为依据检查本次代码变更是否破坏或改变项目已有的业务逻辑。

**校验流程**：

1. **变更影响面识别**：逐个 diff 文件，查找其在 Wiki 业务模块文档（`docs/wiki/business/*.md`）中的关联功能点
2. **影响分类**：

| 影响类型 | 标识 | 说明 |
|----------|------|------|
| 🔴 破坏性变更 | `HB-` | 删除/修改了 Wiki 中记录的历史功能依赖的核心逻辑 |
| 🟡 行为变更 | `HC-` | 修改了 Wiki 中记录的历史功能行为但未删除 |
| 🟢 安全扩展 | `HE-` | 新增代码不影响 Wiki 中记录的已有逻辑 |

3. **模式化判定**：需求审查中，PRD 要求的变更不计入风险，PRD 未提及的变更标为意外影响；基础审查中，不做 PRD 归因，仅判断是否破坏或改变 Wiki 记录的历史逻辑

### 4.6 定制化规范合规性审查 ★ 强制执行 / 不可跳过 ★

> **本步骤为强制执行，不允许跳过、不允许降级。** 必须读取 `{output_dir}/customization.md`（Step 0.2 已强制生成并验证落盘），**逐章对照**检查本次代码变更是否遵循项目定制化规范。
> **若 customization.md 不存在，说明 Step 0 未正确执行，必须立即回到 Step 0.2 生成，不允许以"跳过本步"作为降级方案。**

**审查维度（对应 customization.md 九大章节）**：

| 章节 | 审查维度 | 检查内容 | 严重级 |
|------|---------|---------|--------|
| 三、分层结构 | 分层合规 | 新增代码是否放在正确的层，数据对象类型是否正确 | C-P0 |
| 四、开发规约 | 命名一致性 | 类/方法/变量命名是否符合项目惯例 | C-P1 |
| 四、开发规约 | 注入方式 | Bean 注入是否与项目统一方式一致 | C-P2 |
| 四、开发规约 | 工具类复用 | 是否复用项目已有工具类，不重复造轮子 | C-P1 |
| 五、数据库规范 | DB 命名与 SQL | 表名/字段命名/SQL 编写是否符合内部规范 | C-P0 |
| 六、返回格式 | 接口返回一致性 | 是否使用统一返回类和错误码体系 | C-P0 |
| 七、异常体系 | 异常使用合规 | 是否使用项目统一异常类，不直接抛裸异常 | C-P0 |
| 八、日志规范 | 日志打印合规 | 日志级别/内容/格式是否符合强制规范 | C-P1 |
| 九、业务要求 | 业务特有编码 | 幂等/并发/数据安全等是否符合项目强制要求 | C-P0 |

### 4.7-4.9 实现风险 + 代码质量 + 去重

按 [`references/code-quality-checklist.md`](references/code-quality-checklist.md) 扫描硬伤，最后按指纹去重。

---
## Step 5：产出报告并强制上报 ★ 强制执行 ★

> **本步骤为强制执行，在 Step 4 完成后立即执行。所有审查建议不再本地询问用户，必须按默认采纳状态直接全量上报；用户后续可在平台将不采纳的建议改为不采纳。**

### 5.1 生成审查报告并提取建议

按 [`templates/review-report.md`](templates/review-report.md) 的模式裁剪规则生成审查报告到 `{output_dir}/review-{ts}.md`，并从报告中提取所有审查建议。基础审查不得输出需求覆盖、偏离遗漏或超范围改动章节。

### 5.2 全部建议直接进入上报 ★ 禁止本地询问 ★

**报告生成后，直接将全部审查建议纳入上报数据：**

- **禁止调用 `task_ask_question` 或其他交互工具询问是否采纳**
- **不允许跳过任何一条审查建议**
- **不等待用户确认，立即进入 5.3 执行上报**
- **必须保留 `adoptionStatus` 和 `rejectionReason` 字段**
- **首次上报时 `adoptionStatus` 固定为 `1`（默认采纳），`rejectionReason` 为空字符串；后续由用户在平台将不采纳的建议改为 `0` 并填写原因**

### 5.3 强制记录并上报建议数据 ★ 必须成功 ★

**逐条收集所有审查建议，包括：**
- 建议ID
- 建议内容
- 采纳状态（首次上报默认为采纳）
- 未采纳原因（首次上报为空）
- 相关文件路径

**审查完成后，必须强制执行以下上报流程：**

#### 5.3.1 准备上报数据

将所有审查建议及默认采纳状态写入临时文件 `temp_adoption_data.json`：

```json
[
  {
    "projectId": "项目ID（从当前项目路径提取）",
    "projectName": "项目名称（从当前项目路径提取）",
    "projectBranch": "当前分支",
    "codeReviewId": "审查记录ID（时间戳）",
    "userId": "用户ID",
    "userErp": "用户ERP",
    "userName": "用户名称",
    "filePath": "相关文件路径",
    "suggestionId": "建议ID",
    "suggestionContent": "建议内容",
    "adoptionStatus": 1,
    "rejectionReason": ""
  }
]
```

#### 5.3.2 强制执行上报命令 ★ 必须成功 ★

**上报数据准备完成后，必须使用以下命令强制上报数据：**

```bash
curl -X POST http://hiboos.agent.jd.local/api/ai/review/adoption/batch-submit \
  -H "Content-Type: application/json" \
  -d @temp_adoption_data.json
```

**上报要求：**
- ★ **必须执行上报命令，不允许跳过** ★
- ★ **必须等待上报响应** ★
- ★ **如果上报失败，必须重试至少3次** ★
- ★ **如果3次重试后仍然失败，打印错误信息但继续流程** ★
- 上报成功后，删除临时文件 `temp_adoption_data.json`

#### 5.3.3 上报结果验证

**检查上报响应：**
- 成功响应（HTTP 200）：打印 "✅ 采纳数据上报成功"
- 失败响应：打印错误信息，重试上报
- 网络异常：等待5秒后重试

### 5.4 数据字段说明

| 字段 | 必填 | 说明 | 获取方式 |
|------|:----:|------|---------|
| projectId | 是 | 项目ID | 从当前项目根目录名称提取 |
| projectName | 是 | 项目名称 | 从当前项目根目录名称提取 |
| projectBranch | 是 | 当前分支 | `git rev-parse --abbrev-ref HEAD` |
| codeReviewId | 是 | 审查记录ID | 使用时间戳 `{ts}` |
| userId | 是 | 用户ID | 与 userErp 相同 |
| userErp | 是 | 用户ERP | 从用户目录路径提取（见下方说明） |
| userName | 是 | 用户名称 | 与 userErp 相同 |
| filePath | 是 | 相关文件路径 | 从审查建议中提取 |
| suggestionId | 是 | 建议ID | 自动生成（递增序号） |
| suggestionContent | 是 | 建议内容 | 从审查建议中提取 |
| adoptionStatus | 是 | 采纳状态 | 首次上报固定为 `1`（默认采纳）；平台后续可改为 0-未采纳 |
| rejectionReason | 否 | 未采纳原因 | 首次上报为空；平台改为不采纳时填写 |

**userErp 字段获取方式**：
- **Windows**: 从 `%USERPROFILE%` 环境变量中提取用户目录名
  - 示例：`C:\Users\yangchen.301` → `yangchen.301`
- **macOS/Linux**: 从 `$HOME` 环境变量中提取用户目录名
  - 示例：`/Users/yangchen.301` → `yangchen.301`
- **提取逻辑**：取路径的最后一部分作为 userErp 值

### 5.5 终端输出

**上报过程：**
```
📤 准备上报采纳数据...
   建议：{总数} 条
   采纳状态：全部默认采纳

🔄 正在上报到服务器...
   接口：http://hiboos.agent.jd.local/api/ai/review/adoption/batch-submit
   数据文件：temp_adoption_data.json
   
✅ 采纳数据上报成功
```

---
## Step 6：保存审查记录 ★ 强制执行 ★

> **本步骤为强制执行，在 Step 5 完成后立即执行。**

### 6.1 检查并创建记录目录

检查当前工作目录下是否存在 `.code-review` 目录：
- **如果不存在**：创建 `.code-review` 目录
- **如果已存在**：跳过创建步骤

### 6.2 记录审查信息

在 `.code-review` 目录下的 `code-review-records.md` 文件中追加一行记录：

**记录格式**：
```
{分支名称}={时间戳}
```

**示例**：
```
feature-vector-search=20260616220000
main=20260616221530
bugfix-auth-fix=20260616223000
```

### 6.3 实现逻辑

**Linux/macOS 环境**：
```bash
# 检查并创建目录
if [ ! -d ".code-review" ]; then
  mkdir .code-review
fi

# 获取当前分支名称
branch_name=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

# 获取当前时间戳
timestamp=$(date +%Y%m%d%H%M%S)

# 追加记录到文件
echo "${branch_name}=${timestamp}" >> .code-review/code-review-records.md
```

**Windows 环境**：
```powershell
# 检查并创建目录
if (-not (Test-Path ".code-review")) {
  New-Item -ItemType Directory -Path ".code-review" | Out-Null
}

# 获取当前分支名称
$branchName = git rev-parse --abbrev-ref HEAD 2>$null
if (-not $branchName) { $branchName = "unknown" }

# 获取当前时间戳
$timestamp = Get-Date -Format "yyyyMMddHHmmss"

# 追加记录到文件
"${branchName}=${timestamp}" | Out-File -FilePath ".code-review\code-review-records.md" -Append -Encoding utf8
```

### 6.4 异常处理

- 如果获取分支名称失败，使用 `unknown` 作为分支名称
- 如果文件写入失败，打印错误信息但不阻塞流程
- 确保记录文件的编码为 UTF-8

### 6.5 终端输出

```
📝 审查记录已保存
   分支: {branch_name}
   时间: {timestamp}
   文件: .code-review/code-review-records.md
```

---

## 参考资料导航

- [`references/review-rubric.md`](references/review-rubric.md)——四态判定标准
- [`references/prd-extraction-guide.md`](references/prd-extraction-guide.md)——PRD 解析要点
- [`references/code-quality-checklist.md`](references/code-quality-checklist.md)——代码质量检查项
- [`references/database-conventions.md`](references/database-conventions.md)——数据库规范
- [`references/team-style-guide.md`](references/team-style-guide.md)——团队代码规范
- [`templates/customization-template.md`](templates/customization-template.md)——定制化规范模板（customization.md 生成依据）
- [`templates/requirement-list.md`](templates/requirement-list.md)——需求清单模板
- [`templates/review-report.md`](templates/review-report.md)——报告输出模板
