# Git 工作流规范

> 本规则定义 Commit 信息、分支管理和 Code Review 规范。

---

## 1. Commit 规范

### 格式

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Type 枚举

| type | 含义 |
|------|------|
| `feat` | 新增功能 |
| `fix` | 修复 Bug |
| `refactor` | 重构（不改变功能逻辑） |
| `test` | 修改测试用例 |
| `build` | 修改构建系统/依赖 |
| `chore` | 非业务性修改（工具配置等） |
| `ci` | 修改 CI 流程 |
| `docs` | 修改文档 |
| `style` | 修改代码样式（缩进、空格等） |
| `perf` | 性能优化 |

### Harness 任务追踪 Trailer（AI 编码提交必带）

通过 Harness 流程（coding-impl / feature-lite / bug-fix）产出的代码提交，**必须**在提交信息末尾追加以下 trailer，用于任务↔代码关联和质量指标结算（返工率、采纳率）：

```
feat(order): 实现ES查询DAO层

Harness-Change: 20260610-001-ES查询迁移
Harness-Task: 003
```

| Trailer | 取值 | 说明 |
|---------|------|------|
| `Harness-Change` | 变更目录名（`.harness/changes/` 下的目录名） | 必填 |
| `Harness-Task` | 任务序号（3 位数字，如 `003`） | 关联具体任务时必填 |

**规则**：
- trailer 与正文之间空一行，每行一个 `Key: Value`
- 用户手工修改代码的提交**不要**带这些 trailer——指标结算依靠"有无 trailer"区分 AI 产出与人工返工
- 一次提交只对应一个任务；跨任务改动应拆成多次提交

### 原则

- 单一职责：每个提交只完成一个功能或修复。
- 禁止无意义提交信息。
- Push 前充分测试与代码审查。

## 2. 分支规范

| 分支类型 | 命名 | 说明 |
|----------|------|------|
| 特性分支 | `feature_*` / `feature/*` | 一一对应需求 |
| 集成分支 | `release_*` / `release/*` | 集成回归验证 |
| 主干分支 | `master` / `main` | 基线分支，始终生产就绪 |
| 热修复分支 | `hotfix_*` / `hotfix/*` | 紧急修复线上问题 |

- 分支命名禁止中文。
- 分支间单向合并，禁止不相关交叉合并。
- 已合并分支定期清理。

## 3. Code Review 规范

- CR 描述包含：背景说明、修改内容、预期效果。
- 单一原则：每个 CR 只包含一个功能或修复。
- 合理使用 Squash 保持提交历史简洁。
