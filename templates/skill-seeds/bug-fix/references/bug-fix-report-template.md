# BUG 修复记录（日汇总，追加式）

**输出目录**：`.harness/wiki/bug-fix/`

## 记录信息

- **记录日期**：{{YYYY-MM-DD}}
- **记录文件创建时间**：{{HH:mm}}
- **记录模式**：按天追加（同一天追加到同一文件）
- **文件名**：`report-{YYYYMMDD}-{HHmm}.md`

---

## 当日汇总

- **已完成问题数**：{{completed_count}}
- **待处理问题数**：{{pending_count}}
- **最后更新时间**：{{last_updated_at}}

---

## 问题条目模板（每个问题追加一段）

> 追加规则：按处理时间顺序追加；每条必须带“时间 + 序号”。

## [{{issue_time_HH:mm}}] 问题{{issue_index}}：{{issue_summary}}

### 基本信息

- **模块/功能**：{{module}}
- **严重级别**：{{severity}}
- **处理路径**：{{Fast-Track | Full-Process}}
- **状态**：{{已修复 | 待观察 | 待确认}}

### 问题描述

- **期望行为**：{{expected_behavior}}
- **期望行为依据**：{{requirement_source}}
- **实际行为**：{{actual_behavior}}
- **复现方式**：{{reproduce_steps}}

### 根因与定位

- **文件**：`{{file_path}}`
- **方法/函数**：{{method}}
- **行号**：{{line}}
- **根因**：{{root_cause}}
- **根因类型**：{{cause_type}}

### 修复内容

| 文件 | 改动 | 原因 |
|------|------|------|
| `{{path}}` | {{change}} | {{reason}} |

### 代码改动审查

- **预期改动**：{{expected_changes}}
- **实际改动**：{{actual_changes}}
- **差异分析**：{{diff_analysis}}
- **影响判断**：{{impact_level}}
- **处理决策**：{{decision}}

### 验证结果

- **正例**：{{positive_case_result}}
- **反例**：{{negative_case_result}}
- **回归测试**：{{regression_result}}
- **Code Review**：{{cr_result}}

### 影响与风险

- **影响范围**：{{impact_scope}}
- **风险评估**：{{risk_assessment}}
- **回滚方案**：{{rollback_plan}}

### 治理沉淀

- **经验教训**：{{lessons_learned}}
- **预防措施**：{{prevention_rules}}

---

## 待处理问题（可选）

- [ ] {{pending_issue_1}}
- [ ] {{pending_issue_2}}

---

## 使用说明

1. 当天首个问题：创建 `BUG修复记录_YYYYMMDD-HHMM.md`
2. 当天后续问题：追加到该文件，不新建
3. 每个问题都必须使用 `## [HH:mm] 问题N：...` 标题
4. `N` 为当日递增序号，便于快速定位