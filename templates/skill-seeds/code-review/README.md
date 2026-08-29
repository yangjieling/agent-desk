# Code Review Skill

## 可以参考：https://joyspace.jd.com/pages/2Cojvubx3A9ZezoIv225

代码审查 —— 提供 PRD 或需求清单时检查需求实现是否完整、准确；未提供时执行不含需求正反向比对的基础审查。

## 何时使用

当你需要：
- 对当前代码变更做基础 code review
- 对照 PRD 文档审查代码变更
- 检查需求覆盖度（哪些做了、哪些没做、哪些偏离）
- 发现超范围实现（代码改了但需求没提到的部分）
- 校验代码是否破坏了项目已有的业务逻辑

**触发关键词**：code review、代码审查、review、PRD 审查、需求审查、需求一致性核对、需求覆盖度检查、对照需求 review、prd-code-review

## 快速开始

```bash
# 方式一：提供 PRD 文档路径
> 帮我对照 PRD 审查当前分支的代码变更
> prd_path: docs/prd/feature-xxx.md

# 方式二：提供已整理的需求清单
> 按需求清单审查代码
> requirement_list: docs/prd-review/requirements-xxx.md

# 方式三：不提供 PRD，执行基础审查
> review 当前代码变更
```

## 输入参数

| 参数 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `prd_path` | 否 | — | PRD 文档路径（.md/.txt/.pdf） |
| `requirement_list` | 否 | — | 已拆好的需求清单路径，传入则跳过 PRD 解构 |
| `base` | 否 | 自动解析 | git base 分支 |
| `include_worktree` | 否 | `true` | 是否纳入 staged + unstaged 改动 |
| `output_dir` | 否 | `docs/prd-review/` | 报告输出目录 |

两者都不传时进入基础审查，不主动追问 PRD。

## 工作流程

```
Step 0  项目上下文生成（Wiki 知识库 + customization.md）
  ↓
Step 1  输入校验与模式判定
  ↓
Step 2  获取需求清单 → 落盘 requirements-{ts}.md（仅需求审查）
  ↓
Step 3  Diff 收集
  ↓
Step 4  多维比对
        ├── 4.1 正向扫描（需求 → 代码 四态，仅需求审查）
        ├── 4.2 反向扫描（代码 → 需求 超范围，仅需求审查）
        ├── 4.3 数据库变更扫描
        ├── 4.4 团队规范扫描
        ├── 4.5 历史逻辑影响校验（依据 Wiki）
        ├── 4.6 定制化规范合规性审查（依据 customization.md）
        ├── 4.7 实现风险扫描
        ├── 4.8 关键代码质量扫描
        └── 4.9 多维去重与合并
  ↓
Step 5  产出报告 → review-{ts}.md
  ↓
Step 6  上传报告并返回链接
```

## 产出物

| 文件 | 路径 | 说明 |
|------|------|------|
| Wiki 知识库 | `docs/wiki/` | 项目概述 + 业务模块 + 技术架构 |
| 定制化规范 | `docs/prd-review/customization.md` | 项目代码规范（九大章节） |
| 需求清单（仅需求审查） | `docs/prd-review/requirements-{ts}.md` | 从 PRD 解构出的结构化需求 |
| 审查报告 | `docs/prd-review/review-{ts}.md` | 最终审查结果 |

## 审查维度说明

### 需求覆盖（正向扫描，仅需求审查）

| 状态 | 含义 |
|------|------|
| ✅ 已实现 | 代码完整覆盖需求 |
| 🟡 部分实现 | 主体有了但缺字段/分支 |
| ❌ 未实现 | PRD 提到了但代码没做 |
| ⚠️ 偏离 | 代码做了但与 PRD 不一致 |

### 风险等级

| 等级 | 触发条件 |
|------|----------|
| 🔴 高 | 未实现需求 / 高危硬伤 / 破坏性历史变更 / C-P0 违规 |
| 🟡 中 | 偏离/部分实现 / 实现风险 / 行为变更 / C-P1 违规 |
| 🟢 低 | 全部已实现，仅超范围或低优先级问题 |

## 目录结构

```
skills/code-review/
├── SKILL.md                          # Skill 完整定义
├── README.md                         # 本文件
├── references/
│   ├── code-quality-checklist.md     # 代码质量检查项
│   ├── database-conventions.md       # 数据库规范
│   ├── prd-extraction-guide.md       # PRD 解析要点
│   ├── review-rubric.md              # 四态判定标准
│   └── team-style-guide.md           # 团队代码规范
├── templates/
│   ├── customization-template.md     # 定制化规范模板
│   ├── requirement-list.md           # 需求清单模板
│   └── review-report.md             # 报告输出模板
└── examples/
    └── sample-review/                # 示例审查
```
