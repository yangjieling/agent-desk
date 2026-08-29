# Xingyun Deploy（行云部署）

## 任务

在 **git commit 且 push 成功之后**、治理沉淀之前，经闸门确认后，按需调用独立 skill **`xingyun-deploy`**（`.joycode/skills/xingyun-deploy`）执行行云/JDOS 编译部署。

**前置**：必须已过闸门「推送确认」且 push 成功；push 未成功或跳过推送不得进入本阶段。

**本阶段可跳过**；跳过不影响后续治理沉淀与统计上报。

---

## 输入

- 已完成：闸门「提交确认」通过，**git commit 已成功**，且 **git push 已成功**
- 修改清单 / 当前分支名（供部署参数参考）
- 上线检查摘要（如有）

---

## 确认闸门（强制，由 SKILL.md 开）

进入本阶段时，**必须先开闸门「行云部署」**（含京 ME），再决定是否部署。

### 闸门「行云部署」输出格式

```markdown
## 闸门「行云部署」：是否部署

**提交状态**：已 commit 且已 push（{短 hash / 分支}）
**建议**：{建议部署的环境，如预发 pre；未知则写「待你指定」}

请确认：
1. **确认部署** → 收集 app/env/branch/group，调用 `xingyun-deploy`
2. **跳过部署** → 不部署，直接进入治理沉淀
3. **稍后部署** → 等同跳过（本次流程内不再部署）
```

### 闸门回复约定

| 用户意图 | 处理 |
|---------|------|
| 确认 / 部署 / 部署到预发… | 进入部署执行 |
| 跳过 / 不部署 / 先不发 / 稍后 | **合法跳过**，记录原因 → 进入治理沉淀 |
| 修正环境/应用等 | 记下参数后仍须再次确认或直接进入部署参数收集 |

开闸门时须同步京 ME（见 `@references/gate-notify-template.md`）。

---

## 执行步骤

### 情况 A：用户选择跳过

1. 执行日志记录：`行云部署：跳过（原因：{用户原话或「用户选择跳过」}）`
2. 简要汇报 → 回到 SKILL.md → **步骤 15 治理沉淀**
3. **禁止**假装已部署

### 情况 B：用户确认部署

**部署参数来源（按优先级，禁止重复追问已解析字段）**：

1. 缺陷描述 `【部署信息】` → `query-bug-detail` 解析的 `deploy_app` / `deploy_env` / `deploy_group`
2. `【分支】` / `【分支名称】` → `branch`（如 `feature_20260819_ai`）
3. `【涉及项目】` → 代码仓库名；**行云 app 以【部署信息】的 app 为准**（如 `yzt-base-pay-gateway-test`，可能与仓库名不同）
4. 以上仍缺项时，才向用户追问缺失项

1. 读取并按 `@../xingyun-deploy/SKILL.md` 执行完整部署流程
2. 必填参数：`app` / `env`（pre|prod|eone）/ `branch` / `group` — **从缺陷详情预填；仅缺项时追问，禁止忽略已填写的【部署信息】**
3. 可从上下文预填建议值（如当前 git 分支作 branch），但仍须用户确认
4. `xingyun-deploy` 内部的部署计划确认与 prod 二次确认仍须遵守
5. 部署成功或失败后，输出摘要并回到 SKILL.md

**部署失败**：
- 汇报失败原因
- 询问：重试部署 / 跳过并继续治理沉淀 / 暂停流程
- 用户选跳过或继续 → 进入治理沉淀（不阻塞闭环）
- 用户选重试 → 再次走 `xingyun-deploy`

- 若当前 bug-fix 处于 shared workflow，且后续节点为 `function-test`：

- 部署成功后，除常规 `## 行云部署摘要` 外，还必须追加一段 `## 部署交接上下文`
- 该交接块供下一步 `function-test` 直接消费，禁止只留自然语言摘要
- **HTTP Pod 直连**：`http://<podIP>:<server.port>`（读 `application.yml`，**eone 上可能未监听，须 function-test 5.0.1 验证**）
- **自动填充**：pod `podIP` → `jsf_host=<podIP>:<jsf.properties端口>`（常见 22001）；`http_base_url` 仅作**待验证**提示，加 `http_port_unverified: true`

---

## 截止条件

### 成功（进入治理沉淀）

- 部署完成；或
- 用户经闸门合法跳过；或
- 部署失败但用户选择跳过继续

### 暂停

- 用户明确暂停流程 → 记录后终止（统计是否上报按 constraints 统计约束处理）

---

## 输出

```markdown
## 行云部署摘要

- 是否执行：是 / 跳过（原因：…）
- 应用：{app}
- 环境：{env}
- 分支：{branch}
- 分组：{group}
- 结果：成功 / 失败 / 跳过
- 说明：{构建号、分组进度或失败原因}
```

若部署成功且后续要衔接 `function-test`，还应追加：

````markdown
## 部署交接上下文

```yaml
handoff_to: function-test
deployment:
  app: <app>
  env: <env>
  branch: <branch>
  groups:
    - <group1>
  artifact: <artifact-or-empty>
  status: success
test_entry:
  kind: pending_user_input
  entry_kind: ""
  jsf_host: ""
  jsf_port: "22001"          # 来自 jsf.properties；function-test 应用 lsof 验证
  http_base_url: ""          # 待验证；eone Pod 上 application.yml 端口可能未监听
  http_port_unverified: true
  http_path: ""
notes:
  - 本次缺陷修复已完成部署，可继续验证修复结果
  - function-test：先做 Pod 端口探测（5.0.1）；HTTP 未监听则 jsf_primary
  - jsf_host 可由 podIP + jsf.properties 端口自动填充
```
````

---

## ⛔ 重要提示

- ❌ 禁止未过闸门「行云部署」就触发构建/部署
- ❌ 禁止把「跳过」写成「部署成功」
- ❌ 禁止在未 commit / 未 push 成功时进入本阶段
- ❌ 禁止跳过本闸门直接进治理沉淀（跳过部署也必须先开闸门让用户明确选择）
- ✅ 本阶段结束后必须回到 SKILL.md → 治理沉淀 → 统计收集
