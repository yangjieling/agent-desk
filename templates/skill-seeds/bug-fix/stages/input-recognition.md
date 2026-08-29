# Input Recognition（输入类型识别）

## 任务

识别用户输入的类型，如果是关键字则检索日志，同时判断 Bug 类型，为后续问题分级提供基础信息。

---

## 输入

用户的原始输入，可能是：
- 关键字（traceId、requestId 等）
- 异常堆栈
- 问题描述
- 混合信息

---

## 执行步骤

### 步骤 1：识别输入类型

| 类型 | 判断条件 | 示例 |
|-----|---------|------|
| **关键字** | 纯数字+点号格式，看起来像 ID | `1199580.1016625.17804542238294302` |
| **异常** | 包含 Exception/Error 或堆栈格式 | `java.lang.NullPointerException...` |
| **问题描述** | 自然语言描述问题 | "点击提交按钮没反应" |

### 步骤 2：判断 Bug 类型

**Bug 类型由 AI 根据输入信号自动判断，不需要询问用户。**

| 类型 | 信号 | 说明 |
|------|------|------|
| **code-error** | 报错、NPE、堆栈、错误码、日志ERROR | 代码层面的技术问题（缺陷） |
| **logic-deviation** | 预期不符、需求不一致、功能不对 | 需求理解偏差或实现与设计不一致（需求问题） |

**判断规则**：

| 判定依据 | Bug 类型 |
|---------|---------|
| 有堆栈、有 ERROR、有异常关键字 | code-error |
| 用户描述"报错"、"崩溃"、"服务挂了" | code-error |
| 用户描述"应该是"、"预期是"、"需求不一致" | logic-deviation |
| 两者皆有 | 以 code-error 为主，定位过程中再确认 |

**类型切换**：定位过程中发现类型不一致时，允许动态切换，并告知用户。

### 步骤 3：根据类型执行

#### 关键字
- 读取配置：`cat .harness/wiki/bug-fix/config.json`
- 收集参数：
  - appName：自动获取（package.json/pom.xml）
  - **systemName：自动获取（调用 get_system.sh）**
  - env：**让用户选择**（test/pre/prod）
  - pin：**优先从 git 配置自动获取，获取失败时向用户询问**
    - 优先级：`.harness/wiki/bug-fix/config.json` 已保存值 > `git config user.name` > 向用户询问
    - 获取命令：`git config user.name`（京东内部通常配置为 ERP 账号）
  - **时间范围**：
    - **默认**：今天凌晨 00:00:00 到当前时间
    - **查不到结果时**：如果用户提供时间信息（如"前天"、"上周"、"昨天下午"），则使用用户提供的时间范围
    - **时间戳计算**：AI 负责将时间转换为毫秒时间戳
- **自动获取 systemName**：
  ```bash
BUG_FIX="${BUG_FIX_DIR:-$HOME/.joycode/skills/bug-fix}"
[ -d "$BUG_FIX/scripts" ] || BUG_FIX=".joycode/skills/bug-fix"
[ -d "$BUG_FIX/scripts" ] || BUG_FIX="$HOME/.harness/skills/bug-fix"
[ -d "$BUG_FIX/scripts" ] || { echo "bug-fix scripts 未找到"; exit 1; }
  # appCode 固定使用 -test 后缀格式
  APP_CODE="${appName}-test"
  
  # 调用 get_system.sh 获取 systemCode（统一去掉 -test）
  SYSTEM_CODE=$(bash "$BUG_FIX/scripts/get_system.sh" --appCode "${APP_CODE}" | jq -r '.systemCode')
  
  # SYSTEM_CODE 现在是不带 -test 的基础名（如 yzt-hiboos）
  # log_search.sh 会根据环境自动决定是否添加 -test
  ```
- 调用脚本：
  ```bash
BUG_FIX="${BUG_FIX_DIR:-$HOME/.joycode/skills/bug-fix}"
[ -d "$BUG_FIX/scripts" ] || BUG_FIX=".joycode/skills/bug-fix"
[ -d "$BUG_FIX/scripts" ] || BUG_FIX="$HOME/.harness/skills/bug-fix"
[ -d "$BUG_FIX/scripts" ] || { echo "bug-fix scripts 未找到"; exit 1; }
  # 第一步：检索日志
  bash "$BUG_FIX/scripts/log_search.sh \
    --keyword "关键字" \
    --appName "应用名" \
    --systemName "系统名" \
    --env "环境" \
    --pin "用户账号" \
    --startTime "开始时间戳(毫秒)" \
    --endTime "结束时间戳(毫秒)"
  ```
- 获取完整上下文：
  ```bash
BUG_FIX="${BUG_FIX_DIR:-$HOME/.joycode/skills/bug-fix}"
[ -d "$BUG_FIX/scripts" ] || BUG_FIX=".joycode/skills/bug-fix"
[ -d "$BUG_FIX/scripts" ] || BUG_FIX="$HOME/.harness/skills/bug-fix"
[ -d "$BUG_FIX/scripts" ] || { echo "bug-fix scripts 未找到"; exit 1; }
  # 第二步：基于检索结果获取完整上下文
  bash "$BUG_FIX/scripts/log_context.sh \
    --file "从 log_search.sh 返回的 file 字段" \
    --baseLineNum "从 log_search.sh 返回的 lineNum 字段" \
    --env "环境" \
    --pin "用户账号"
  ```
- **最终保存配置**：日志检索成功后，保存完整配置到 `.harness/wiki/bug-fix/config.json`（包含 appName、systemName、env、pin，确保配置正确可用）

#### 异常或问题描述
- 直接进入下一步

---

## 截止条件

### 成功
- **关键字**：日志检索完成，获得完整的异常信息或上下文
- **异常/问题描述**：识别完成，信息足够进入问题分级
- Bug 类型已判断

### 失败
- **关键字类型但缺少必要参数**（pin 或 env）：
  - 处理方式：告知用户"对不起，缺少必要参数无法进行日志检索，流程终止"
  - 建议用户准备好信息后重新开始
- **日志检索脚本执行失败**：
  - 处理方式：记录失败原因，建议用户手动查看日志或改用"问题描述"方式
- **无法识别输入类型**：
  - 处理方式：向用户确认问题类型（关键字/异常/问题描述）
- **无法判断 Bug 类型**：
  - 处理方式：默认按 code-error 处理，在后续定位过程中动态调整

---

## 输出

### 输入类型
- 类型：关键字 / 异常 / 问题描述
- 检索到的日志（如有）：完整的日志内容
- 异常详情（如有）：完整的异常信息和堆栈
- 上下文信息（如有）：日志中相关的业务上下文

### Bug 类型
- 类型：code-error / logic-deviation
- 判断依据：基于哪些信号判断的
- 后续影响：
  - **code-error**：按技术问题处理，定位根因
  - **logic-deviation**：按需加载需求上下文，与用户确认预期行为

**确认闸门（由 SKILL.md 开）**：本阶段完成后，须经 **闸门「Bug列表」** 锁定目标 Bug（单条复述或多条选定，含京 ME），再进入问题分级。

---

## 参考：Bug 类型信号清单

### code-error 信号

| 信号类型 | 关键词/格式 |
|---------|------------|
| 异常堆栈 | NPE、NullPointerException、空指针 |
| 错误码 | 500、502、504、ERROR |
| 用户描述 | "报错"、"崩溃"、"服务挂了" |
| 日志片段 | `Exception`、`Caused by`、`at xxx.java` |
| 编译错误 | cannot find symbol、编译失败 |

### logic-deviation 信号

| 信号类型 | 关键词/模式 |
|---------|------------|
| 预期不符 | "应该是"、"预期是"、"本应该" |
| 需求对照 | "和需求不一致"、"不符合 PRD"、"设计要求" |
| 业务逻辑 | "业务逻辑有误"、"金额算错了"、"状态不对" |
| 功能表现 | "功能不对"、"表现不符合预期" |