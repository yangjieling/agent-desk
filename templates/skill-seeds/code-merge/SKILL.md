---
version: 1.0.0
name: code-merge
description: >-
  编码与代码审查完成后,把当前功能分支合并到目标主干(或创建/推进 PR)。
  Use when the user asks to 合并、合主干、merge、开 PR、合并请求,或系统流程编排进入「合并」步骤。
  不负责行云部署/上线。
---


# 代码合并 Skill

把**当前仓库已审查通过的功能分支**合并到目标分支(默认 `master`/`main`),或创建/推进 Pull Request。

本技能**不做部署、不上线、不改业务代码**(除非解决纯合并冲突且用户确认)。

分支与提交规范见 `references/git-workflow.md`。

## 输入

- 当前工作区 git 仓库
- 前序步骤(编码/审查)上下文:变更说明、目标分支、是否已 push
- 用户指定的目标分支(未指定则探测 `master` 或 `main`)

## 步骤

### 1. 摸清仓库状态

在项目根目录执行并汇报:

```bash
git rev-parse --show-toplevel
git status -sb
git branch -vv
git remote -v
```

确认:

- 当前分支名(不可在脏工作区直接合主干)
- 是否已跟踪远程
- 目标主干:`master` 或 `main`(以仓库默认分支为准)

工作区有未提交改动时,**先开闸门说明**,不要擅自 stash/commit。

### 2. 开闸门「合并确认」

在执行 `merge` / 创建 PR / `push` 之前必须停下来等用户确认。

输出:

```markdown
## 闸门「合并确认」
当前分支:`<feature>`
目标分支:`<main>`
拟执行:`<创建 PR / 本地 merge + push / 仅说明无法自动合>`

请确认是否继续合并。本步不部署、不上线。

## hb-choices
- 确认合并到 <main> | 确认合并
- 只创建 PR 不合入 | 只开PR
- 取消 | 取消
```

用户未确认前禁止 `git merge`、`git push`、创建 PR。

### 3. 按用户选择执行

**确认合并**

1. `git fetch origin` (有远程时)
2. 确保功能分支已 push:`git push -u origin HEAD` (若尚未推送且用户已确认合并,可一并推)
3. 优先用平台能力合入:
   - `gh pr create` / `gh pr merge` (GitHub)
   - 或京东代码托管对应 CLI(若环境已配置)
4. 若无 PR 工具,则检出目标分支、`git merge --no-ff <feature>`、再 push 目标分支
5. 出现冲突:停止,列出冲突文件,开闸门「合并冲突」等用户指示,不要强推

**只开 PR**

创建 PR 后输出链接,不要 merge。

**取消**

本步以「已取消合并」收口,不要改 git 状态。

### 4. 本步收口

成功后输出简短总结(分支、合入方式、PR 链接、commit SHA),标题写成:

`## 闸门「合并确认」— 已确认`

然后结束本轮,等待编排器进入下一步测试。禁止自行开始部署或接口自测。

## 禁止

- 禁止 `git push --force` 到 `master`/`main`
- 禁止在未确认闸门时合入
- 禁止本步调用行云部署 / 上线 checklist
- 禁止顺手改业务代码(冲突解决除外,且须说明)
