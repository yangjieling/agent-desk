# Create Fix Branch（创建修复分支）

## 任务

在 **闸门「修复方案」已通过** 之后、**修改业务代码之前**：

1. 取得目标功能分支 `feature_branch`（优先缺陷描述【分支名称】，禁止 master/main）
2. **校验主工作区当前分支**；不在目标分支时按策略切换或改用 worktree
3. 经闸门「建分支确认」后，优先调用 **`aegis-fix-branch`** 在 worktree 创建 `fix/<bug>`；或用户明确「当前分支直接改」

**前置**：必须已过闸门「修复方案」（快速通道还须已过「Bug原因」）。

**推荐默认：worktree 隔离**——**不必切换用户当前打开的主工作区分支**，AI 在独立 worktree 修，主仓未提交改动不受影响。

仅当用户明确选择「在当前分支直接改」时，才必须把主工作区切到目标功能分支后再改代码。

---

## 输入

- 闸门「修复方案」已通过
- Bug 编号 / 标题（用于建议 `fix/<bug-code>`）
- 仓库本地路径（当前打开的 git 仓库；无法确定则追问）
- **目标功能分支**（优先顺序）：
  1. 缺陷完整度 / 描述中的 `【分支名称】`
  2. 用户在闸门中明确给出的分支名  
  ❌ 禁止猜测；❌ 禁止使用 master / main

---

## 分支校验（强制，改代码前）

进入本阶段后、改业务代码前，对主工作区执行：

```bash
python3 ../aegis-fix-branch/scripts/ensure_checkout_branch.py \
  --repo-path <repo> \
  --target-branch <feature_branch> \
  --check-only
```

解析 stdout JSON：

| `action_needed` | 含义 | 处理 |
|-----------------|------|------|
| `none` | 已在目标分支 | 继续闸门「建分支确认」 |
| `checkout` | 不在目标分支，工作区干净 | **默认直接切换**（无需问用户）：去掉 `--check-only` 再跑，或 `--apply checkout` |
| `user_decision` | 不在目标分支，且有未提交改动 | **必须开闸门与用户交互**（见下） |
| `abort` | 非法分支 / git 错误 | 停止并汇报 |

### 有未提交改动时的闸门（可与「建分支确认」合并展示）

```markdown
## 闸门「建分支确认」：分支不一致且工作区有改动

**缺陷**：{bug_code}
**目标功能分支**：{feature_branch}（来自缺陷【分支名称】）
**当前分支**：{current_branch}
**未提交改动**：
\`\`\`
{dirty_summary}
\`\`\`

主工作区当前不在目标分支。请选择：

1. **stash 后切换到目标分支，再建 fix worktree**（推荐：保留改动）
2. **stash 后切换到目标分支，并在当前工作区直接改**（不建 worktree）
3. **不切换主工作区，直接用 worktree 隔离修复**（主仓分支与未提交改动保持不动）
4. **取消** → 停止，不改代码

## oh-choices
- stash 后切分支并建 worktree | stash_worktree
- stash 后切分支并在当前区直接改 | stash_direct
- 不切主仓，用 worktree 隔离 | worktree_only
- 取消 | cancel
```

用户确认后执行：

```bash
# 选项 1 / 2：先 stash 再切
python3 ../aegis-fix-branch/scripts/ensure_checkout_branch.py \
  --repo-path <repo> \
  --target-branch <feature_branch> \
  --apply stash
# 再按选项调用 aegis-fix-branch 或进入「当前分支直接改」
```

选项 3：跳过主仓 checkout，直接 `aegis-fix-branch`（worktree 从 feature 拉 fix）。

**禁止**未开闸门就 `--apply discard` 丢弃用户改动。

### 无需用户决定时的默认

- 工作区干净且不在目标分支 → **直接 checkout**（不必开「脏区决策」子闸门）
- 已在目标分支 → 不切换
- 脏区 → **必须**经 joycode-cli / 对话闸门让用户选；用户若回复「按默认」/「stash」→ `--apply stash`

---

## 确认闸门（强制，由 SKILL.md 开）

进入本阶段时，**必须先开闸门「建分支确认」**（含京 ME），再执行建分支或主仓切换后的直接改。未确认前禁止创建 worktree、禁止改业务代码。

### 闸门「建分支确认」输出格式

```markdown
## 闸门「建分支确认」：创建修复分支

**缺陷**：{bug_code 或标题}
**目标功能分支**：{feature_branch}（来自【分支名称】或请用户补充）
**主工作区当前分支**：{current_branch}（一致 / 将切换 / 将保持不动走 worktree）

**拟操作（推荐）**：不切换主工作区 → 从功能分支在 worktree 拉出 `fix/<bug>`，后续改代码在 worktree

请确认：
1. **功能分支名**（feature_branch）：若完整度已有则展示并请确认；缺失则必填
2. **修复分支名**（可选）：默认 `fix/{bug_code}`
3. **仓库路径**（若上下文不明确）

选项：
1. **确认建分支（worktree，不切主仓）** → 调用 `aegis-fix-branch`（推荐）
2. **切到功能分支后在当前工作区直接改** → 须先 `ensure_checkout_branch`（脏区须用户已选 stash）
3. **取消** → 停止流程，不改代码

## oh-choices
- 确认建 worktree（不切主仓） | confirm_worktree
- 切到目标分支后直接改 | checkout_direct
- 取消 | cancel
```

### 闸门回复约定

| 用户意图 | 处理 |
|---------|------|
| 确认建 worktree + feature 已知 | 调用 `aegis-fix-branch`（主仓可不切换） |
| 确认但未给分支名且完整度也无 | **再追问** feature_branch，禁止猜测 |
| 切到目标分支后直接改 | 先 `ensure_checkout_branch`（干净自动切；脏区须已 stash 决策）→ 主工作区改代码 |
| 取消 / 先不改 | 停止，不改代码 |

开闸门时须同步京 ME（见 `@references/gate-notify-template.md`）。

**禁止**：
- ❌ 禁止猜测 / 默认填充 feature_branch（完整度已解析出的【分支名称】可预填但须用户确认）
- ❌ 禁止未过本闸门就调用建分支脚本或改业务代码
- ❌ 禁止把「建分支确认」与「修复方案」合并成一次确认
- ❌ 禁止在脏工作区未询问用户时擅自 stash / discard / checkout

---

## 执行步骤

### 情况 A：worktree 隔离（推荐，可不切换主仓）

1. （可选）`--check-only` 记录当前分支与脏区状态到执行日志
2. 调用：

```bash
python3 ../aegis-fix-branch/scripts/create_fix_branch.py \
  --repo-path <repo> \
  --feature-branch <feature> \
  --bug-code <code>
```

3. 解析 JSON：`fix_branch` / `worktree_path` / `commit_hash` / `reused_existing`
4. 后续 **所有 Read/Edit 在 worktree_path**，主仓当前分支可保持不动
5. 回到 SKILL.md → **修复实施**

### 情况 B：用户选择「切到功能分支后在当前工作区直接改」

1. `ensure_checkout_branch`：干净 → checkout；脏 → 须已 `--apply stash`
2. 确认 `on_target=true` 后再改代码
3. 执行日志记录：`跳过 worktree；已切换到 {feature_branch}（stash={stash_ref}）`
4. 输出：`worktree_path` 为空 / `fix_branch` = 当前分支名
5. 进入修复实施（cwd=主工作区）

**建分支 / 切换失败**：
- 汇报失败原因
- 询问：重试 / 改用另一路径 / 取消
- 禁止失败后擅自改主工作区代码

---

## 截止条件

### 成功（进入修复实施）

- `aegis-fix-branch` 成功拿到 `worktree_path`；或
- 用户明确「当前区直接改」且主工作区 **已在** `feature_branch`

### 失败（停等用户）

- 脏区未决策 / 脚本失败 / 用户取消

---

## 输出

```markdown
## 创建修复分支摘要

- 是否隔离 worktree：是 / 否（跳过原因）
- 功能分支：{feature_branch}
- 主仓切换：未切换（worktree）/ 已 checkout / stash 后 checkout（stash_ref）
- 修复分支：{fix_branch 或 当前分支}
- worktree：{worktree_path 或 主工作区}
- commit：{短 hash 或 —}
- 是否复用已有 fix 分支：是 / 否 / —
```

下游 **修复实施 / 验证 / commit / push** 必须使用本摘要中的分支与路径。

---

## ⛔ 重要提示

- ❌ 禁止未过闸门「建分支确认」就建分支或改代码
- ❌ 禁止猜测 feature_branch；禁止 master/main
- ❌ 禁止建分支失败后悄悄改主工作区
- ❌ 禁止跳过本阶段直接进入修复实施
- ❌ 禁止「当前区直接改」时不在目标功能分支上改代码
- ✅ **不切换主仓也能修**：用 worktree（推荐）
- ✅ 脏区切换必须经用户闸门；干净则默认切换
- ✅ 建分支成功后，后续改代码一律在 `worktree_path` 中操作
- ✅ 本阶段结束后必须回到 SKILL.md → 修复实施
