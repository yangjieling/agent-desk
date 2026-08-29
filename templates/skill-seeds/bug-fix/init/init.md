# BugFix Skill 初始化

## 任务

在项目根目录下创建 BugFix Skill 所需的目录结构和文件。

---

## 执行步骤

### 步骤 1：创建目录结构

```bash
mkdir -p .harness/wiki/bug-fix/knowledge
```

### 步骤 2：获取配置信息

**【强制执行规则 - 大模型必须严格遵守】**

✅ **正确提取顺序（优先级从高到低）**：
1. **优先自动提取** - 所有信息优先从项目文件中自动读取，禁止人工猜测
2. **自动提取失败** - 明确列出缺失项，要求用户手动填写，禁止默认填充

---

#### 🔍 字段提取规则（每条规则必须严格执行）

| 字段 | 提取来源 | 提取规则（必须100%遵守） | 验证规则 |
|-----|---------|-------------------------|----------|
| **app_name** | `pom.xml`（Maven项目）<br>`package.json`（前端项目） | **Maven 项目提取规则：**<br>1. 打开项目根目录 `pom.xml`<br>2. **第一步：定位 `<parent>` 块** - 找到以 `<parent>` 开头、`</parent>` 结尾的代码块<br>3. **第二步：跳过父 POM 的 artifactId** - `<parent>` 块内部的 `<artifactId>` 是父依赖，**绝对不能用**<br>4. **第三步：取当前项目的 artifactId** - 在 `</parent>` 标签**之后**，找到第一个 `<artifactId>` 标签的值，这才是当前项目的 app_name<br>5. **验证规则**：该值不能包含 "dependencies"、"parent"、"bom" 等父 POM 特征关键字<br><br>**NPM 项目提取规则：**<br>1. 打开项目根目录 `package.json`<br>2. 取顶层 `name` 字段的值<br><br>✅ 正确示例：<br>父 POM 是 `<artifactId>dong-boot-dependencies</artifactId>`（跳过）<br>当前项目是 `<artifactId>yzt-base-pay-gateway</artifactId>`（提取）<br><br>❌ 错误示例：<br>绝对不能取 `dong-boot-dependencies` 作为 app_name | 必须匹配正则 `^[a-z0-9-]+$`，长度5-64位 |
| **system_name** | app_name 自动推导 / get_system.sh | **自动推导规则：**<br>1. 从 app_name 中去掉末尾的技术后缀：`-gateway`、`-service`、`-app`、`-web`、`-api`、`-impl`、`-domain`、`-common`、`-entity`、`-job`、`-test`<br>2. 如果包含 `-base-`、`-core-`、`-common-` 等标识，取前3段作为系统名<br>3. 示例：`yzt-base-pay-gateway` → 去掉 `-gateway` → `yzt-base-pay`<br><br>**API 补全规则：**<br>如果自动推导结果不准确，执行：<br>`bash "$BUG_FIX/scripts/get_system.sh" --appCode "{app_name}"`（先按 log-search-interface 解析 BUG_FIX）<br>取返回结果中的 `systemCode` 字段 | 必须匹配正则 `^[a-z0-9-]+$`，长度3-32位 |
| **pin/erp** | git 配置 / 环境变量 | 1. 执行 `git config user.name` 获取 pin<br>2. 执行 `git config user.email` 取 `@` 前面部分作为 erp<br>3. git 配置为空时，取系统环境变量 `$USER` | 必须是有效的京东ERP账号，格式通常为 `拼音.数字` |
| **env** | 默认值 | 固定默认值为 `test`，用户可根据需要修改为 `pre` 或 `prod` | 只能是 `test`/`pre`/`prod` 三者之一 |

---

#### ❌ 禁止行为（违反即视为错误）
1. 禁止从 `<parent>` 块内提取 app_name
2. 禁止使用父 POM 的 artifactId 作为 app_name
3. 禁止在自动提取失败时随意填充默认值
4. 禁止跳过验证规则直接生成配置

---

**手动询问模板（仅当自动提取失败时使用）：**
```markdown
⚠️ 无法自动获取以下信息，请手动填写：

- app_name：应用名称（当前项目的 artifactId）
- system_name：系统名称（从 app_name 推导或业务系统名）
- pin：京东 ERP 账号
```

### 步骤 3：创建配置文件

创建 `.harness/wiki/bug-fix/config.json`：

```json
{
  "basic": {
    "app_name": "{自动获取或用户输入}",
    "system_name": "{自动获取或用户输入}"
  },
  "user": {
    "pin": "{自动获取或用户输入}",
    "erp": "{自动获取或用户输入}"
  },
  "env": {
    "value": "test"
  }
}
```

### 步骤 4：创建知识沉淀文件

创建 `.harness/wiki/bug-fix/knowledge/README.md`：

```markdown
# BugFix 知识库

本目录存放 Bug 修复过程中沉淀的知识。

## 文件说明

- `rules.md` - 预防规则汇总
- `checklist.md` - 检查清单汇总
```

创建 `.harness/wiki/bug-fix/knowledge/rules.md`：

```markdown
# 预防规则

本文件记录 Bug 修复过程中沉淀的预防规则。
```

创建 `.harness/wiki/bug-fix/knowledge/checklist.md`：

```markdown
# 检查清单

本文件记录 Bug 修复过程中沉淀的检查项。
```

---

## 输出

```markdown
## BugFix Skill 初始化完成

### 已创建
- `.harness/wiki/bug-fix/config.json`
- `.harness/wiki/bug-fix/knowledge/rules.md`
- `.harness/wiki/bug-fix/knowledge/checklist.md`