# Resume Protocol — 单文档断点续跑协议

> 目的：让 test-plan.md **本身**成为唯一的状态源。任何 Agent（不管上一次是谁跑的、用的什么模型）打开它，都能立刻接着往下走，不遗漏、不重跑、不覆盖历史。

## 一、核心原则

1. **单文档原则**：整个 function-test 生命周期只维护一份 md 文件（默认 `<repo>/.harness/changes/<change-id>/test-plan.md`）。**不允许**再产生临时 scratch 文件、任务清单、进度笔记。
2. **状态即文档**：文档顶部 `## 0. 执行状态` 就是唯一的状态机。恢复靠它，推进靠它，交接也靠它。
3. **只 append**：所有 Stage 产物、执行记录、失败根因都是**追加**到对应章节，绝不覆盖已有内容。§ 0 状态块除外——它按原子替换。
4. **每一步都写状态**：每完成一个动作，立即用 [`scripts/update_state.sh`](../scripts/update_state.sh) 更新 § 0，把「下一步命令」写清楚。**先写状态，再动手**（意味着若中断，恢复者读到的永远是"下一步要做什么"，而不是"我刚做完但没记")。

## 二、恢复入口（新 Agent 必读）

任何 Agent 加载 function-test skill 后，第一件事：

```
问用户：是新任务还是继续 <path>/test-plan.md？
```

如果用户提供已有 md 路径 → **进入恢复模式**：

1. `read_file` 读整份 md
2. 定位 `## 0. 执行状态` 到 `<!-- STATE:END -->` 之间的 YAML code block
3. 按下面「状态字段语义」判断当前处于哪个 Stage、卡在哪个闸门
4. 严格按 `next_action` 字段执行下一步；**不允许**自行推断"应该从头再来"
5. 若 `blocked_on` 有值，先向用户复述该闸门问题，等回复

## 三、状态块格式（§ 0）

```markdown
## 0. 执行状态

<!-- STATE:BEGIN — 本块由 function-test skill 维护，人类可读、机器可写 -->
```yaml
schema_version: 1
change_id: 20260818-001-示例变更
repo: /path/to/repo
branch: feature/xxx
head_sha: a1b2c3d
base: origin/master
author: chuyaxin.5 <chuyaxin.5@jd.com>
created_at: 2026-08-18T15:30:00+08:00
updated_at: 2026-08-18T16:12:22+08:00

# --- 进度 ---
current_stage: stage5_execute        # 见 § 四 stage 枚举
stage_status: in_progress            # pending / in_progress / done
blocked_on: null                     # 若闸门，填闸门名；否则 null

# --- 闸门 ---
gates:
  change_confirmed:  {status: passed, at: 2026-08-18T15:35:00+08:00, note: "用户确认只测自己 3 个 commit"}
  scope_confirmed:   {status: passed, at: 2026-08-18T15:50:00+08:00, note: "覆盖用例 1/2/3，用例 4 冒烟"}
  entry_confirmed:   {status: passed, at: 2026-08-18T16:05:00+08:00, note: "host=6.244.233.39:22012"}
  failure_disposal:  {status: pending, at: null, note: null}

# --- 执行上下文（Stage 5 用）---
jsf_host: 6.244.233.39:22012
env: test
run_id_prefix: "08181530"
runs:
  - run_id: 08181530-001
    case: "报损创建 opType=33"
    result: pass
    at: 2026-08-18T16:08:00+08:00
  - run_id: 08181530-002
    case: "报损出库 opType=35"
    result: fail
    at: 2026-08-18T16:12:00+08:00
   failure_ref: "§8.1"              # 指向 §8 里的根因段落

# --- 待办用例（未完成的用例列表，Stage 5 每跑一条从这里删并 append 到 runs）---
pending_cases:
  - case_id: 3
    title: "报损取消 opType=34"
    param_file: /tmp/case-03.json

# --- 下一步（恢复者必看）---
next_action:
  kind: run_case                     # ask_user / run_case / write_report / handoff_bugfix / done
  summary: "执行用例 3 报损取消"
  command: |
    bash $FT_DIR/scripts/jsf_invoke.sh \
      --host 6.244.233.39:22012 \
      --interface com.yzt.stock.erp.api.StorageStockChangeGeneric \
      --method invoke \
      --param-file /tmp/case-03.json \
      --run-id 08181530-003
  after_success:
    update_state:
      stage_status: in_progress
      append_run: {run_id: 08181530-003, case: "报损取消 opType=34"}
```
<!-- STATE:END -->
```

**严禁**在 `STATE:BEGIN`/`STATE:END` 之间放非 YAML 内容或多份 YAML；块内容必须能被 `PyYAML.safe_load` 解析。

## 四、Stage 枚举与流转

| stage 值 | 含义 | 完成标志 |
|----------|------|----------|
| `stage1_collect` | 改动梳理 | § 1 已写入；`gates.change_confirmed.status = passed` |
| `stage2_scope` | 范围确认 | § 2 已写入；`gates.scope_confirmed.status = passed` |
| `stage3_impact` | 链路影响分析 | § 3 已写入（无闸门） |
| `stage4_plan` | 测试方案设计 | § 4/5/6 已填充 |
| `stage5_execute` | 执行验证 | `pending_cases` 清空 |
| `stage6_report` | 结果汇报 | § 9 结论写入；`gates.failure_disposal.status = passed`（若有失败）|
| `done` | 全部结束 | — |

流转规则：只能沿枚举顺序前进；若中途发现前面遗漏，允许**回退**到目标 stage 并在 `updated_at` 之外增加 `revisions:` 数组记录。

## 五、next_action.kind 语义

| kind | 含义 | 恢复者动作 |
|------|------|-----------|
| `ask_user` | 等用户回复闸门问题 | 复述 `summary` 里的问题，等回答；不动手 |
| `run_case` | 执行一条用例 | 直接跑 `command`，成功后按 `after_success` 更新状态 |
| `write_report` | 生成通过/失败汇报段落 | 追加到 § 8/9，然后更新状态 |
| `handoff_bugfix` | 切 bug-fix skill | 调用 bug-fix，传入 md 路径 + 失败根因 |
| `done` | 结束 | 归档并汇报用户 |

## 六、原子写入

**任何**更新 § 0 的操作必须通过 [`scripts/update_state.sh`](../scripts/update_state.sh)：

```bash
bash $FT_DIR/scripts/update_state.sh \
  --plan /path/to/test-plan.md \
  --set current_stage=stage5_execute \
  --set stage_status=in_progress \
  --set-gate scope_confirmed=passed \
  --append-run '{"run_id":"08181530-002","case":"报损出库","result":"fail","failure_ref":"§8.1"}' \
  --set-next-action '{"kind":"write_report","summary":"填 §8.1 根因","command":""}'
```

脚本行为：

1. 读整份 md，提取 `STATE:BEGIN..STATE:END` 之间的 YAML
2. 用 Python 合并字段（保留未指定的字段原样）
3. 刷新 `updated_at`
4. 写回时使用**临时文件 + 原子 mv**，避免并发/中断损坏
5. 若 md 中不存在状态块 → 报错退出（禁止自动创建，除非通过 `gen_test_plan.sh` 初始化）

## 七、并发与冲突

- 同一份 md **同一时刻只能有一个 Agent 在写**；用文件锁 `flock`（`update_state.sh` 内置）。
- 若发现 `updated_at` 与自己上次读到的不一致 → 说明有别人改过，**必须重读整份 md 后再继续**，不允许基于陈旧状态覆盖。

## 八、恢复者行为准则

1. 读到 `blocked_on=<gate>` → 直接把 § 0 里对应闸门的 `note` 提炼给用户，等待回复
2. 读到 `pending_cases=[]` 且 `stage=stage5_execute` → 状态推进到 `stage6_report`
3. 读到 `next_action.kind=run_case` → **不重复**已在 `runs` 里的 run_id
4. 遇到状态块解析失败 → 停手，向用户汇报："状态块损坏，请手动确认 § 0 内容"，不要试图修复
5. **绝不**跳过状态更新执行下一步动作——一步一状态是恢复能力的根基