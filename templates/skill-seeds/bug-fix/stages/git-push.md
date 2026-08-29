# Git Push（代码推送）

## 任务

在 **git commit 成功之后**、行云部署之前，经闸门「推送确认」后，在**修复分支所在目录**（有 worktree 则 `cd` / `git -C <worktree_path>`）执行 **先 pull 再 push**，将本地提交推送到远程。

**本阶段可跳过推送**；跳过则不得进入行云部署，直接进入治理沉淀。

---

## 输入

- 闸门「提交确认」已通过，且 **git commit 已成功**
- 当前分支名（应为步骤 9 的 `fix_branch` 或用户声明的当前分支）、远程跟踪分支（如有）
- `worktree_path`（如有；push 必须在该目录执行）

---

## 确认闸门（强制）

commit 成功后，**必须先开闸门「推送确认」**（含京 ME），再决定是否 push。未确认前禁止 pull/push。

```markdown
## 闸门「推送确认」：是否推送到远程

**提交状态**：已 commit（{短 hash / 分支}）
**拟操作**：先 `git pull --rebase`，再 `git push`

请确认：
1. **确认推送** → 执行 pull + push
2. **跳过推送** → 不 push，跳过行云部署，进入治理沉淀
3. **稍后推送** → 等同跳过
```

### 闸门回复约定

| 用户意图 | 处理 |
|---------|------|
| 确认 / 推送 / 可以 | 进入 pull + push 执行 |
| 跳过 / 不推 / 稍后 | **合法跳过**，记录原因 → **跳过行云部署** → 进入治理沉淀 |
| 修正说明 | 更新后再次开本闸门 |

开闸门时须同步京 ME（见 `@references/gate-notify-template.md`）。

---

## 执行步骤（仅用户确认推送后）

### 步骤 1：确认提交状态

```bash
git status
git log -1 --oneline
```

确认工作区干净（相对刚完成的 commit），记录：分支名、短 hash。

若仍有未提交改动：停止推送，汇报异常，请用户处理后再继续。

### 步骤 2：先拉代码（pull）

优先使用 rebase，减少无意义的 merge commit：

```bash
# 已设置 upstream 时
git pull --rebase

# 无 upstream 时：先获取远程再与 origin/<当前分支> rebase
git fetch origin
git rebase origin/$(git branch --show-current)
```

**若 pull / rebase 出现冲突**：

1. **立即 abort，禁止手工继续强推或跳过冲突**：
   ```bash
   git rebase --abort   # rebase 冲突时
   # 或
   git merge --abort    # 若实际走的是 merge
   ```
2. 向用户汇报并**停止流程**（不得进入行云部署）：
   ```markdown
   ⚠️ 推送前 pull 发生冲突，已 abort，请先本地解决冲突后再继续。

   **分支**：{branch}
   **本地提交**：{短 hash}
   **冲突说明**：{git 输出摘要 / 冲突文件列表}

   请你本地处理完冲突并确认仓库状态正常后，回复「继续推送」或「已解决，继续」。
   ```
3. 用户确认已解决后，**从本阶段步骤 2 重试**（再次 pull → push），不得跳过 pull。

### 步骤 3：推送（push）

pull 成功后执行：

```bash
git push
# 无 upstream 时
git push -u origin HEAD
```

**若 push 被拒绝 / 远端有新提交导致非快进（视为冲突类失败）**：

1. **禁止** `push --force` / `--force-with-lease`（除非用户在本对话中明确要求）
2. abort 本次推送意图，汇报并停止：
   ```markdown
   ⚠️ git push 失败（远端有更新或冲突），未强制推送。请先拉代码解决冲突后再继续。

   **分支**：{branch}
   **失败原因**：{git 输出摘要}

   建议：本地执行 pull 并解决冲突后，回复「继续推送」。
   ```
3. 用户确认后从步骤 2 重试。

### 步骤 4：成功汇报

```
📍 代码推送完成：已 pull 并 push 到 {remote}/{branch}（{短 hash}）
→ 下一步：行云部署确认
```

---

## 截止条件

### 成功

- 用户确认推送，且 pull 无冲突、push 成功 → 进入闸门「行云部署」
- 用户经闸门合法跳过推送 → 跳过行云部署，进入治理沉淀

### 失败（停等用户）

- pull/rebase 冲突已 abort
- push 被拒绝 / 非快进失败
- 无远程或权限错误（汇报原因，请用户处理）

---

## 输出

```markdown
## 代码推送摘要

- 是否推送：是 / 跳过（原因）
- 分支：{branch}
- 提交：{短 hash}
- pull：成功 / 冲突已 abort / 未执行
- push：成功 / 失败（原因）/ 跳过
- 远程：{origin/branch 或未推送}
```

---

## ⛔ 重要提示

- ❌ 禁止未过闸门「推送确认」就执行 pull/push
- ❌ 禁止跳过 pull 直接 push
- ❌ 禁止在冲突未 abort 的情况下继续改代码或进入行云部署
- ❌ 禁止未经用户明确要求使用 `push --force`
- ❌ 禁止把 push 失败 / 跳过写成「已推送成功」
- ❌ 禁止未 push 成功就进入行云部署（跳过推送时直接进治理沉淀）
- ✅ 冲突 abort 后必须等用户解决并明确继续，再从 pull 重试
