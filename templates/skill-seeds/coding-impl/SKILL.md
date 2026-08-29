---
version: 1.0.0
name: coding-impl
description: "任务拆分完成、存在待执行 task 文件后触发；或用户说「开始编码」「继续下一个任务」。无任务文件时不适用，先走 task-breakdown。"
---


## hb-cli 运行适配

由 `hb` 任务或系统流程编排调用时遵守以下适配,优先级高于下文 JoyCode/Harness 专用门禁:

1. **不要**因缺少 `~/.harness/scripts/report-skill-usage.sh` 而中止;改用与其它 hb skill 相同的使用量上报 curl(若失败不阻塞)。
2. **不要**因「上下文隔离门禁」要求 `/clear` 或新窗口而停止执行;在当前 hb 任务会话内继续。
3. 项目级 `.harness/skills/<本技能>/SKILL.md` 不存在时,直接使用本文件。
4. Harness 规则文件若路径不存在,改读本技能目录下 `references/`(含 `references/rules/`)。
5. 本步只完成本技能职责,不要自行进入流程中的后续 skill;闸门确认后给出本步总结并结束本轮。

# 编码 Skill

## 推荐上下文

> 解析与跳过规则见 `rules/skill-conventions.md` §一（`.harness/` 优先，缺失跳过不阻塞）。

优先读取:
1. 当前任务文件 `.harness/changes/{变更目录}/task-{序号}-{短名}.md`
2. 当前需求的 `design.html`
3. 当前需求的 `README.md`(任务流程清单)
4. `rules/coding/naming-and-format.md` — 命名和代码风格
5. `rules/coding/security-and-quality.md` — 安全和质量规范
6. `rules/coding/logging-and-comments.md` — 日志与注释规范
7. `rules/code-query-tool-check.md` — 代码查询工具检查

按需读取:
- `wiki/middleware/*` — 当前任务涉及中间件时
- `rules/coding/git-workflow.md` — 提交代码时

### 中间件规约预读取（涉及中间件时按需读取）

**在开始编码前,检查当前任务是否涉及中间件操作。如果涉及,尝试读取对应的中间件使用指南(不存在则跳过,按通用最佳实践编码):**

1. 读取当前任务文件 `task-{序号}-{短名}.md`,检查实现方案和改动清单中是否涉及中间件
2. 如果涉及,尝试读取 `.harness/wiki/middleware/` 下对应的使用指南:

| 任务涉及内容 | 尝试读取的指南 |
|-------------|-------------|
| Redis/缓存操作、分布式锁 | `jimdb-guide.md` |
| 数据库操作、SQL、Mapper | `mysql-druid-guide.md`、`mybatis-guide.md` |
| 消息发送/消费、MQ 监听 | `jmq-guide.md` |
| RPC 调用、服务提供/消费 | `jsf-guide.md` |
| 动态配置读取/监听 | `ducc-guide.md` |
| 限流、熔断、降级 | `sentinel-guide.md` |
| 监控埋点、告警 key | `ump-guide.md` |
| 定时任务 | `tbschedule-guide.md` |
| 日志打印 | `log4j2-guide.md` |

**指南读取到时遵守:**
- **使用项目已有的工具类/封装**:指南中"工具类与封装"列出的类和方法,直接调用,不自行封装
- **遵守命名规范**:缓存 key、MQ topic、UMP key 等必须遵循指南中的命名规则
- **遵守禁止事项**:指南中"禁止事项与注意点"中列出的条目为硬性约束
- **参考实际用法示例**:指南中的代码示例作为编码风格参考

**指南不存在时**:跳过此步骤,不阻塞流程,按通用最佳实践编码。

## 编码要求

1. 只修改当前任务文件中"改动清单"列出的文件。
2. 不允许顺手重构。
3. 不允许删除原有逻辑，除非需求明确要求。
4. 每个新增判断必须说明业务依据。
5. **提交代码时必须携带 Harness trailer**（`Harness-Change: {变更目录名}` + `Harness-Task: {任务序号}`，规范见 `.harness/rules/coding/git-workflow.md`）。这是任务↔代码关联和质量指标结算（返工率、采纳率）的基础，不可省略。

6. **代码结构镜像任务结构**：
   - 主方法按 task 文件「关键步骤 → 高层流程」分段，每段调用一个子方法
   - 子方法按「低层细节」实现，单方法 ≤30 行，嵌套 ≤3 层，使用早返回（guard clause）
   - 段落留白 + 段首单行注释概括意图（段首注释只描述本段做什么）
   - 规则依据：`.harness/rules/coding/naming-and-format.md §3 代码结构`

7. **日志按计划落地**：严格按 task 文件「日志与注释计划 → 关键日志点」表落地，
   不多打（避免噪声）、不少打（避免黑盒）。
   规则依据：`.harness/rules/coding/logging-and-comments.md`。

8. **注释只写 WHY，不写 WHAT**：
   - 三类允许的注释：Javadoc（公共 API 做什么 + 约束）、段首注释（长方法分段）、行内注释（复杂业务分支的业务规则/历史决策/性能权衡）
   - **禁止**：对一目了然的代码加注释（如 `i++; // i 加 1`）
   - **禁止**：对正在做的任务、对调用者、对 PR 编号写注释（这些进 commit message）
   - **禁止**：注释掉的代码（用 git 追溯）、空洞 TODO
   - 规则依据：`.harness/rules/coding/logging-and-comments.md §4`。

9. **类引用必须走 import，禁止在代码体内写全限定名（FQCN）**：
   - ✅ 正确：文件顶部 `import com.yzt.open.rpc.mt.MTOrderServiceWrap;`，方法体内 `MTOrderServiceWrap service = ...;`
   - ❌ 禁止：方法体内 `com.yzt.open.rpc.mt.MTOrderServiceWrap service = ...;`
   - 例外仅两种：(a) 同一文件出现同名类需消歧义；(b) 反射/字符串 API（`Class.forName("...")`、`@Autowired(required=false)` 的 SpEL 等）
   - 变量声明、字段声明、方法参数、返回类型、泛型参数、注解值、cast、instanceof 全部适用
   - 规则依据：`.harness/rules/coding/naming-and-format.md §2 代码格式`（"统一 import 顺序"）

## 任务执行流程

### Step 0.1：翻 stage 到 coding-impl（强制）

> **🔴 必须执行（紧接 Step 0）**：把最近修改的 `.harness/changes/<req>/state.md` 里 `stage` 字段翻到 `coding-impl`，避免指标采集卡在上一阶段。
> - **Windows**：运行 `"%USERPROFILE%\.harness\scripts\set-stage.bat" coding-impl`
> - **macOS/Linux**：运行 `bash "$HOME/.harness/scripts/set-stage.sh" coding-impl`

### Step 1：确认当前任务

读取当前需求变更目录下的 `README.md`，找到状态为 `pending` 且前置依赖已全部 `completed` 的**第一个**任务：
- 路径：`.harness/changes/{YYYYMMDD}-{序号}-{需求名}/README.md`
- **README.md 的任务流程清单表格是判断任务可执行性的权威来源**：通过"前置依赖"列找到依赖的任务序号，再通过"状态"列确认这些依赖是否已 `completed`
- task 文件 frontmatter 中的 `depends_on` 字段作为补充参考，但以 README.md 表格为准
- **每次只选取一个任务**，完整走完 `pending → in_progress → in_review → completed` 全部状态后，才能选取下一个任务

然后读取对应的任务文件 `task-{序号}-{短名}.md`，了解完整的任务要求。

### Step 1.1：标记任务为 in_progress（强制）

> **🔴 必须执行**：开始编码前，**必须先**将当前任务标记为 `in_progress`。这是任务快照和返工检测的起点——`in_progress` 触发工作区快照记录（`task-snapshot.py snapshot start`），如果跳过此步直接编码，返工检测将因缺少 start 快照而无法工作。

> - **Windows**：`"%USERPROFILE%\.harness\scripts\update-task-status.bat" "{变更目录名}" "{任务序号}" in_progress`
> - **macOS/Linux**：`bash "$HOME/.harness/scripts/update-task-status.sh" "{变更目录名}" "{任务序号}" in_progress`

**确认脚本输出包含 `✅ 已更新` 后再开始编码。**

### Step 1.2：复用决策核对（强制，轻量）

1. 读当前 task 文件「实现方案 → 复用阶梯检查」段落：
   - **段落存在** → 严格按表执行（② 级用现成的、⑥ 级才新写），不再做新决策
   - **段落缺失**（老任务、quick-change、hotfix、纯修改类任务）→ 跳过本步，正常编码

2. 编码中若遇到以下情况，**立即停下**，不要自行扩展：
   - 想新增"改动清单"和"复用阶梯检查"表之外的类/方法/工具/依赖
   - 发现某 ⑥ 级新写项，其实项目里已有等价能力（拆分时漏判）

   **评估范围决定动作**：
   - 小范围调整（同任务内）：更新 task 文件「改动清单」+「复用阶梯检查」表一行，继续编码
   - 影响任务边界（跨任务、需新增任务）：按 Step 4「阶段回退指引」回退到 task-breakdown

3. 红线项（校验/异常/鉴权/审计/安全防御）**不得以"简化"为由删除**，
   即使任务文件没显式列出。

### Step 2：执行编码

按照任务文件中的"实现方案 → 关键步骤"逐步完成编码。

### Step 2.5：编码自检（推荐）

> 验证纪律（证据要求、禁语清单、失败处理）见 `skills/verification-before-completion/SKILL.md`：无验证证据不得宣布完成。

**编码完成后、标记 completed 前，执行以下自检，确保代码质量：**

1. **Lint 检查**：运行项目配置的静态检查工具
   ```bash
   # Java: Maven 项目
   mvn checkstyle:check 2>/dev/null || echo "CHECKSTYLE_NOT_CONFIGURED"
   
   # Node: ESLint
   npx eslint --no-error-on-unconfigured-pattern {changed_files} 2>/dev/null || echo "ESLINT_NOT_CONFIGURED"
   
   # Go: vet
   go vet ./... 2>/dev/null || echo "GO_VET_NOT_APPLICABLE"
   ```

2. **相关单元测试**：运行当前任务涉及的测试
   ```bash
   # Java: 运行变更模块的测试
   mvn test -pl {module} 2>/dev/null || echo "TEST_COMMAND_NOT_STANDARD"
   
   # Node: Jest
   npx jest --related {changed_files} 2>/dev/null || echo "JEST_NOT_CONFIGURED"
   ```

3. **编译检查**：确保代码可编译
   ```bash
   # Java
   mvn compile -pl {module} -q 2>/dev/null || echo "COMPILE_FAILED"
   
   # Node
   npx tsc --noEmit 2>/dev/null || echo "TSC_NOT_CONFIGURED"
   
   # Go
   go build ./... 2>/dev/null || echo "GO_BUILD_FAILED"
   ```

4. **结构与日志注释自检**（分两步：先机械 grep 抓红线，再人工核对计划）

   **4a. 机械检查（命中即修，不可跳过）：**

   ```bash
   # 敏感字段泄漏（改动文件里日志方法调用中出现敏感字段名 → 强烈可疑）
   grep -rnE "log\.(info|error|warn|debug).*(password|passwd|token|secret|idCard|mobile|phone|bankCard)" {改动文件}

   # 循环体内日志(粗筛：日志调用前 3 行内出现 for/while)
   grep -rnB3 "log\.(info|debug)" {改动文件} | grep -E "for\s*\(|while\s*\(" | head

   # 字符串拼接式日志(应改为占位符)
   grep -rnE 'log\.(info|error|warn|debug)\([^)]*\+' {改动文件}
   ```

   任一命中 → 修复后再继续；如为业务必需（如带脱敏工具类的字段），保留但需在 task 文件「关键日志点」表补充说明。

   **4b. 计划-实现一致性核对（人工，打开 task 文件对着 diff 走）：**

   - [ ] 「关键日志点」表里的每一行：diff 里是否都打了？位置、级别、字段是否一致？
   - [ ] diff 里额外打的日志（表里没有）：是否有合理理由？没有 → 删掉；有 → 补进表里
   - [ ] 「关键注释点」列出的 WHY：diff 里是否都加了？
   - [ ] diff 里是否出现"一目了然的注释"、注释掉的旧代码、空洞 TODO？→ 删掉

   **4c. 代码结构自检：**

   - [ ] 主方法是否能在一屏内看完整体流程？（超出 → 拆子方法）
   - [ ] 任意方法是否 >30 行？（是 → 按「低层细节」拆分）
   - [ ] 嵌套是否 >3 层？（是 → 早返回 / 提取子方法）

   > 任一项未通过 → 修复后再标记 in_review。

**自检结果处理**：
- Lint/编译失败：**必须修复后再继续**，不可跳过
- 测试失败：**必须修复后再继续**，不可标记 in_review
- 工具未配置：跳过对应检查，不阻塞流程

**自检结果埋点（质量指标，best-effort）**：自检完成后上报**首次**自检结果（首次失败后修复再通过，仍按 `fail` 上报，修复过程不再重复上报）：

> - **Windows**：`"%USERPROFILE%\.harness\scripts\report-event.bat" self_check --skill coding-impl --change "{变更目录名}" --task "{任务序号}" --payload "{\"result\":\"pass|fail\",\"lint\":\"pass|fail|skip\",\"compile\":\"pass|fail|skip\",\"test\":\"pass|fail|skip\"}"`
> - **macOS/Linux**：`bash "$HOME/.harness/scripts/report-event.sh" self_check --skill coding-impl --change "{变更目录名}" --task "{任务序号}" --payload '{"result":"pass|fail","lint":"pass|fail|skip","compile":"pass|fail|skip","test":"pass|fail|skip"}'`

### Step 3：编码完成 — 标记 in_review 并移交代码审查（强制）

**固定执行顺序（不可打乱、不可跳过）：3.1 标记 `in_review` → 3.2 输出编码完成报告 → 3.3 弹出审查选择（强制交互）→ 3.4 按选择处理。**

**审查选择（3.3）是本 Skill 的完成门禁**：标记完 `in_review`、输出完报告后，**下一个动作必须是调用交互工具弹出审查选择**，不允许在弹出前插入任何复杂度评估、git diff 统计、额外分析或说明性文本。

- `review_choice` 为空时禁止调用 `attempt_completion`、输出最终完成报告、需求完成总结或静默结束，也禁止调用任何 Code Review。
- 无论是否存在标准 task 文件，只要本 Skill 本轮实际写了代码并完成自检，都必须经过此门禁。
- 只有 `review_choice=执行基础 code-review` 才允许调用 Code Review；选择暂不执行时禁止调用。

#### 3.1 更新任务状态为 in_review

通过 `update-task-status` 脚本统一更新 task 文件和 README.md（同时触发埋点）：

> - **Windows**：`"%USERPROFILE%\.harness\scripts\update-task-status.bat" "{变更目录名}" "{任务序号}" in_review`
> - **macOS/Linux**：`bash "$HOME/.harness/scripts/update-task-status.sh" "{变更目录名}" "{任务序号}" in_review`

#### 3.2 输出编码完成报告

```
✅ 任务 #{序号} 编码完成，进入代码审查阶段

📝 改动摘要：
- 新增文件：{列表}
- 修改文件：{列表}

🔍 编码自检结果：
- Lint：✅ 通过 / ⚠️ 跳过（未配置）
- 测试：✅ 通过
- 编译：✅ 通过

📋 状态已更新：
- task-{序号}-{短名}.md → status: in_review
- README.md → 任务 #{序号} 状态: in_review
```

#### 3.3 弹出审查选择（强制交互，必须紧接 3.2）

**输出完 3.2 报告后，下一个动作必须是调用 `task_ask_question`（或当前环境等价的交互工具）弹出可点击选项。禁止只输出 Markdown 选项或用普通文本询问，禁止在弹出前先做复杂度评估 / git diff 统计 / 任何额外分析。**

- 问题：「代码实现和自检已完成，是否执行基础 code-review Skill 审查本次变更？」
- 选项:
  - 「执行基础 code-review（推荐）」
  - 「暂不执行」
- 将工具返回结果记录为 `review_choice`，等待用户选择，不得默认代选。
- **交互工具调用失败** → 立即换用当前环境其他交互工具重试；**所有交互工具均不可用** → 输出阻塞原因并停止（保持 `in_review`），禁止继续审查或结束任务。

#### 3.4 按 review_choice 处理

**A. `review_choice=执行基础 code-review`：**

1. **（可选）复杂度评估作为审查重点提示**——仅在本步执行，用于给 `code-review` 传递重点风险，不作为门禁、不阻塞：
   ```bash
   CHANGED_FILES=$(git diff --name-only HEAD -- {改动清单中的文件列表})
   FILE_COUNT=$(echo "$CHANGED_FILES" | grep -c '.' || echo 0)
   MODULE_COUNT=$(echo "$CHANGED_FILES" | sed 's|/[^/]*$||' | cut -d'/' -f1-2 | sort -u | wc -l | tr -d ' ')
   ```
   得分维度（每项命中 +1）：`FILE_COUNT>2` / `MODULE_COUNT>1` / 对外接口变更 / 并发·事务·异步 / DB·缓存·数据迁移。得分 ≥2 时，将命中的复杂点作为 `focus_hints` 传给 `code-review`；失败或算不出直接跳过。

2. 以 `review_mode: basic_diff` 调用 `code-review` Skill，只审查当前任务改动清单对应的 git diff，只执行以下两项基础校验：
   - **关键代码质量与团队规范**：读取 `skills/code-review/references/code-quality-checklist.md` 和 `skills/code-review/references/team-style-guide.md`；团队规范只采用与当前项目技术栈及既有用法匹配的条款。
   - **数据库规范**：仅当 diff 涉及 SQL、DDL、Mapper、DAO 或事务时，读取 `skills/code-review/references/database-conventions.md`，只检查 D1xx、D2xx、D3xx，不执行依赖 PRD 的 D0xx。

   本次调用不传 `prd_path` / `requirement_list`，不执行需求覆盖、设计一致性、Wiki、历史逻辑或全项目审查。随后按 3.5 处理审查结果。

3. **环境不支持 Skill 间调用** → 输出可重放的 `/code-review review_mode=basic_diff` 指令，保持 `in_review` 并结束当前轮次。

**B. `review_choice=暂不执行`：** 禁止调用任何 Code Review，保持 `in_review` 并结束当前轮次。

#### 3.5 处理审查结果

解析 `code-review` Skill 返回的审查报告。

**每轮审查结果埋点（质量指标，best-effort）**：收到每轮审查报告后立即上报：

> - **Windows**：`"%USERPROFILE%\.harness\scripts\report-event.bat" review_result --skill coding-impl --change "{变更目录名}" --task "{任务序号}" --payload "{\"round\":{轮次},\"result\":\"pass|fail\",\"critical\":{🔴数},\"warn\":{🟡数}}"`
> - **macOS/Linux**：`bash "$HOME/.harness/scripts/report-event.sh" review_result --skill coding-impl --change "{变更目录名}" --task "{任务序号}" --payload '{"round":{轮次},"result":"pass|fail","critical":{🔴数},"warn":{🟡数}}'`

然后按结果分支处理：

- **✅ 通过**：
  1. 如有 🟡/🟢 建议，自行判断是否采纳并修改
  2. 通过 `update-task-status` 脚本标记 `completed`：
     > - **Windows**：`"%USERPROFILE%\.harness\scripts\update-task-status.bat" "{变更目录名}" "{任务序号}" completed`
     > - **macOS/Linux**：`bash "$HOME/.harness/scripts/update-task-status.sh" "{变更目录名}" "{任务序号}" completed`
  3. 输出审查通过摘要

- **❌ 需修改**（第 1 轮）：
  1. 逐条分析审查报告中明确且可执行的问题
  2. 定向修改代码
  3. 重新运行编码自检（lint/compile/test）
  4. 仍按上述两项基础校验调用一次 `code-review` Skill 复查（round: 2），附带 prior_issues
  5. 第 2 轮 ✅ → 通过 `update-task-status` 脚本标记 `completed`（命令同上）
  6. 第 2 轮 ❌ → **卡点升级**，输出卡点报告等待用户决策

**卡点升级输出**：

```
⛔ 代码审查卡点（已达最大审查轮次 2/2）

审查任务：task-{序号}-{短名}

未解决问题汇总：
| # | 问题 | 第1轮反馈 | 修改内容 | 第2轮结果 |
|---|------|----------|---------|----------|

请选择处理方式：
1. 接受当前版本 → 将问题记入 ambiguity-register.md，通过 `update-task-status` 脚本标记 `completed`
2. 手动指导修改 → 告诉我修改方向，修改后通过 `update-task-status` 脚本标记 `completed`（不再自动复查）
3. 回退到编码阶段 → 重新执行 coding-impl
```

**卡点埋点（质量指标，best-effort）**：输出卡点报告的同时上报：

> - **Windows**：`"%USERPROFILE%\.harness\scripts\report-event.bat" blocked --skill coding-impl --change "{变更目录名}" --task "{任务序号}" --payload "{\"stage\":\"code_review\",\"user_choice\":\"{用户后续选择1|2|3}\"}"`
> - **macOS/Linux**：`bash "$HOME/.harness/scripts/report-event.sh" blocked --skill coding-impl --change "{变更目录名}" --task "{任务序号}" --payload '{"stage":"code_review","user_choice":"{用户后续选择1|2|3}"}'`

### Step 4：检查是否继续

代码审查通过、任务标记 `completed` 后：
1. 重新读取 `README.md`，**确认当前任务的状态已变为 `completed`**
2. 检查是否还有 `pending` 且前置依赖已全部 `completed` 的任务
3. 如果有，询问用户是否继续执行下一个任务
4. **继续执行时，必须从 Step 1 重新开始**（选取下一个任务 → Step 1.1 标记 `in_progress` → Step 2 编码 → Step 2.5 自检 → Step 3 标记 `in_review` → 审查 → 标记 `completed`），**不可跳过任何状态**
5. 如果所有任务都已 `completed`，输出需求完成总结
6. 需求完成总结输出后，**引导接口自测**（见下方 Step 5）

### Step 5：接口自测引导（编码完成后，可选但默认推荐）

编码完成后（全部任务 `completed`，或轻量通道代码写完），主动询问用户是否对本次改动做**接口自测**——这是运行时验证（真实起服务 → 打真接口 → 查库核对 → 自动修复重测），比 Step 2.5 的编码自检（lint/compile/单测）更重，因此在编码完成后按需触发，不强制：

1. 用 AskUserQuestion 问一句：「本次改动已编码完成，是否现在做接口自测？（启动服务 → 打真实接口 → 查库核对 → 自动修复重测，全自动跑到通过）」选项：**是（推荐）** / **否，稍后手动**。
2. **用户选「是」** → 进入 `api-selftest` skill，把**本次变更目录 / 改动涉及的接口范围**作为输入传给它；由该 skill 桥接到 `/api-selftest` 插件的多 Agent 自测闭环。
3. **用户选「否」** → 跳过，提示后续可随时 `/api-selftest` 或直接进入 `test-report`，不阻塞主流程。

> 桥接细节、插件未安装时的降级见 `skills/api-selftest/SKILL.md`。

---

## 状态流转规则

任务状态有以下四种，**必须严格单向、逐步流转，不可跳过任何状态**：

```
pending → in_progress → in_review → completed
   │           │             │           │
   │     snapshot start      │     snapshot end
   │     (返工检测起点)       │     + analyze(返工检测)
   │           │             │           │
   └───────────┴─────────────┴───────────┘
         每个状态变更必须通过 update-task-status 脚本
```

| 状态 | 含义 | 触发条件 | 关联的指标采集动作 |
|------|------|----------|--------------------|
| pending | 待执行 | 任务拆分时的初始状态 | — |
| in_progress | 编码中 | **开始编码时必须标记（强制）** | `task-snapshot.py snapshot start`（记录工作区基线快照）；首次进入 coding-impl 阶段时写入 `coding_impl_start_ms` |
| in_review | 待审查 | 编码自检通过后标记（强制），随后进入 code-review | 事件埋点 `task_status` |
| completed | 已完成 | code-review 审查通过后标记 | `task-snapshot.py snapshot end` + `analyze`（返工检测）；全部完成时触发 `metrics-report.py` 结算 |

**重要**：所有状态变更必须通过 `update-task-status.sh` / `.bat` 脚本执行，**禁止直接用 Edit 工具修改 task 文件或 README.md 的状态字段**。脚本会同时更新 task 文件 + README.md，并自动触发质量指标埋点和结算。

### 逐任务串行规则（强制）

1. **同一时间只有一个任务处于 `in_progress` 状态**——当前任务必须走完 `in_progress → in_review → completed` 全流程后，才能将下一个任务标记为 `in_progress`
2. **每个任务的状态变更必须逐步进行**——`pending → in_progress → in_review → completed`，每一步都通过 `update-task-status` 脚本执行
3. **禁止批量标记**——不可一次性将多个任务从 `pending` 直接标记为 `completed` 或跳过中间状态
4. **`in_progress` 是指标采集的关键起点**——跳过 `in_progress` 会导致：
   - 任务快照缺失 → 返工检测（`.rework.json`）无法工作
   - 编码开始时间戳缺失 → 编码耗时指标为空
   - README.md 状态列不同步 → 全部完成判定可能异常

---

## 禁止行为

1. **禁止直接编辑状态字段**：所有任务状态变更必须通过 `update-task-status.sh` / `.bat` 脚本，禁止用 Edit 工具直接修改 task 文件或 README.md 的状态
2. **禁止跳过 in_progress**：每个任务开始编码前必须先标记 `in_progress`，这是快照采集和返工检测的前提
3. **禁止跳过 in_review**：coding-impl 只标记 `in_review`，`completed` 由审查通过后标记
4. **禁止跳过任何状态**：必须严格按 `pending → in_progress → in_review → completed` 逐步流转，不可从 `pending` 直接跳到 `completed` 或 `in_review`
5. **禁止批量标记**：每完成一个任务的**一个状态变更**立即调用一次 `update-task-status`，不要积攒多个任务或多个状态一起处理
6. **禁止并行处理多个任务**：同一时间只处理一个任务，当前任务走完 `completed` 后才选取下一个
7. **禁止手动修改已完成任务的状态回退**：除非用户明确要求
8. **禁止在自检未通过时标记 in_review**：只有 lint/compile/test 通过后才能标记

---

## 需求完成总结模板

当所有任务都已 `completed` 时，输出以下总结：

```
✅ 需求 [{需求名}] 全部任务已完成！

📊 完成统计：
- 任务总数：{N} 个
- 完成时间跨度：{首个任务开始时间} ~ {末个任务完成时间}

📝 变更文件汇总：
- 新增文件：{N} 个
- 修改文件：{N} 个
- 删除文件：{N} 个

📋 关键变更：
{列出每个任务的核心改动，每个任务一行}

📋 模糊点最终状态：
{读取 ambiguity-register.md，列出所有条目的最终状态}
- 已关闭：{N} 项
- 仍 open：{M} 项（建议在 Code Review 时关注）

🔍 建议下一步：
1. 运行全量测试，确认无回归
2. 进行 Code Review
3. 检查是否需要更新部署配置或运维文档
```

### 质量指标结算（自动触发）

最后一个任务通过 `update-task-status.sh` 标记 `completed` 时，脚本检测到全部任务完成，会**自动运行** `metrics-report.py --change "{变更目录名}"`，生成质量报告。

如果自动结算失败，脚本会输出提示，用户可手动执行：

> - **Windows**：`python "%USERPROFILE%\.harness\scripts\metrics-report.py" --change "{变更目录名}"`
> - **macOS/Linux**：`python3 "$HOME/.harness/scripts/metrics-report.py" --change "{变更目录名}"`

---

## 阶段回退指引

编码过程中如果发现以下问题，应暂停编码并回退到对应的上游阶段：

| 发现的问题 | 应回退到 | 回退动作 |
|-----------|---------|---------|
| 需求理解有误，spec.html 描述与实际意图不符 | request-analysis | 暂停编码，告知用户需要重新确认 spec.html |
| 技术方案不可行，发现设计缺陷 | tech-design | 暂停编码，告知用户 design.html 中的具体问题，建议修改方案 |
| 任务拆分遗漏，发现需要新增未预料的任务 | task-breakdown | 暂停编码，告知用户需要补充任务文件 |
| 任务描述与实际代码不符，改动清单有误 | task-breakdown | 暂停编码，告知用户需要修正任务文件 |

**回退原则**：
- 不要在编码阶段自行修改 spec.html、design.html 或 README.md 的内容（状态字段除外）
- 发现问题时立即告知用户，说明具体问题和建议的回退阶段
- 等待用户确认后再决定是回退还是继续

**回退埋点（质量指标，best-effort）**：用户确认回退后上报（回退本身就是上游阶段质量的负向信号，`to` 取值 `request-analysis|tech-design|task-breakdown`）：

> - **Windows**：`"%USERPROFILE%\.harness\scripts\report-event.bat" rollback --skill coding-impl --change "{变更目录名}" --task "{任务序号}" --payload "{\"to\":\"{回退阶段}\",\"reason\":\"{一句话原因}\"}"`
> - **macOS/Linux**：`bash "$HOME/.harness/scripts/report-event.sh" rollback --skill coding-impl --change "{变更目录名}" --task "{任务序号}" --payload '{"to":"{回退阶段}","reason":"{一句话原因}"}'`

如果回退到 task-breakdown 后**补充了新任务**，补充完成时额外上报一条 `task_added_late`（payload：`{"count":{新增任务数},"reason":"{原因}"}`，命令格式同上）。
