---
version: 1.0.0
name: bug-fix-report
description: >-
  出具 Bug 修复报告。在 bug 排查定位修复完成后，按模板生成结构化修复报告并落盘。
  Use when the user asks to 出修复报告、写 bug 报告、BUG修复文档、生成修复记录、
  bug fix report、修复总结，或 bug-workflow / bug-fix 流程进入「生成报告 / 治理沉淀」步骤时使用。
---


# Bug 修复报告

专门负责出具 Bug 修复报告。不负责查列表、定位、改代码；只在修复与验证完成后整理并落盘报告。

## 触发时机

| 场景 | 识别信号 |
|------|----------|
| 流程内调用 | `bug-workflow` Step 11 / `bug-fix` 治理沉淀 |
| 用户显式要求 | 「出修复报告」「写 bug 报告」「生成修复记录」 |
| 修复收尾 | 闸门「提交确认」通过后需要留存记录 |

## 报告模式

| 模式 | 何时用 | 模板 | 输出路径 |
|------|--------|------|----------|
| **single**（单次报告） | `bug-workflow` 复杂问题收尾；用户要独立报告 | `@references/single-report-template.md` | `doc/BUG修复文档/YYYYMMDD-HHMM-问题简述.md` |
| **daily**（日汇总追加） | `bug-fix` / harness 治理沉淀；同日多问题 | `@references/daily-report-template.md` | `.harness/wiki/bug-fix/report-{YYYYMMDD}-{HHmm}.md` |

默认规则：
- 从 `bug-workflow` 进入 → **single**
- 从 `bug-fix` / harness 进入 → **daily**
- 用户指定模式时以用户为准
- **简单问题**：可跳过完整报告，但须向用户说明并征得同意

## 输入（缺什么补什么）

生成前尽量收集以下字段（可从上游流程上下文直接带入）：

| 字段 | 必填 | 说明 |
|------|------|------|
| 问题标识 | 是 | bugId / 标题 |
| 期望行为 + 依据 | 是 | 文档路径 / 用户口述 / 代码推断 |
| 实际行为 | 是 | |
| 复现步骤 | 建议 | |
| 根因 | 是 | 文件/方法/行号 + 说明 |
| 改动清单 | 是 | 文件、改动、原因 |
| 验证结果 | 是 | 正例 + 反例；回归情况 |
| Code Review | 建议 | 影响范围是否一致 |
| 严重级别 / 路径 | 建议 | 低中高；快速通道/完整流程 |

信息不足时：列出缺失项，向用户补问；不要用空占位糊弄必填字段。

## Agent 执行步骤

```
任务进度：
- [ ] Step 1: 使用量上报（见文首）
- [ ] Step 2: 确定报告模式（single / daily）与输出目录
- [ ] Step 3: 收集/核对输入字段；缺失则补问
- [ ] Step 4: 读取对应模板并填充（禁止留 {{占位符}}）
- [ ] Step 5: 落盘；daily 模式按天追加，不重复建无关文件
- [ ] Step 6: 向用户回报报告路径 + 一句话摘要
```

### single 模式

1. 确保目录存在：`doc/BUG修复文档/`（相对当前业务项目根目录）
2. 读取 `@references/single-report-template.md`
3. 填充全部章节；无遗留问题则删除「遗留问题」节
4. 保存为：`doc/BUG修复文档/YYYYMMDD-HHMM-问题简述.md`
5. 若修复导致文档与代码行为不一致，提示同步更新相关文档（本 skill 可改文档，但需在结果中标注）

### daily 模式

1. 确保目录存在：`.harness/wiki/bug-fix/`
2. 读取 `@references/daily-report-template.md`
3. 当天首个问题：新建 `report-{YYYYMMDD}-{HHmm}.md`，写当日汇总 + 第一条问题
4. 当天后续问题：追加到当日已有报告文件（按时间找最新同日前缀文件），更新汇总计数
5. 每条问题标题格式：`## [HH:mm] 问题N：{摘要}`，`N` 当日递增

## 输出回报格式

```
📄 Bug 修复报告已生成
- 模式：{single|daily}
- 路径：{绝对或相对路径}
- 摘要：{一句话根因 + 修复结果}
```

## 与相关 skill 的边界

| Skill | 职责 |
|-------|------|
| `bug-workflow` | 列表→详情→排查→定位→修复；**Step 11 调用本 skill** |
| `bug-fix` | 工程化修复；**治理沉淀阶段调用本 skill** 出报告 |
| `bug-fix-harness` | harness 版修复入口；治理沉淀调用本 skill |
| **bug-fix-report**（本 skill） | 只出具并落盘修复报告 |
| `jm-notify` | 可选：报告生成后通知相关人（需用户确认） |

## 注意事项

- 期望行为依据必须填写来源，不得留空
- 验证部分须体现正例 + 反例（或明确说明为何无法自动化及用户确认情况）
- 不在本 skill 内改业务代码、不重新定位根因
- 简单问题跳过报告须用户确认
