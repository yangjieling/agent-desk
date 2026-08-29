#!/usr/bin/env bash
# gen_test_plan.sh - 生成测试方案 md 骨架（handoff 风格）
#
# 用法：
#   bash gen_test_plan.sh --repo <path> --title <标题> [--output <path>]
#                         [--change-id <yyyyMMdd-序号-简述>]
#                         [--author-only true]
#
# 行为：
#   - 自动调用同目录 collect_diff.sh 拿到改动清单
#   - 按模板落地 test-plan.md（默认 <repo>/.harness/changes/<change-id>/test-plan.md）
#   - 若已存在同名文件：备份 .bak 后覆盖，不损失历史
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

REPO=""
TITLE=""
OUTPUT=""
CHANGE_ID=""
AUTHOR_ONLY="true"
BASE="origin/master"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)         REPO="$2"; shift 2 ;;
    --title)        TITLE="$2"; shift 2 ;;
    --output)       OUTPUT="$2"; shift 2 ;;
    --change-id)    CHANGE_ID="$2"; shift 2 ;;
    --author-only)  AUTHOR_ONLY="$2"; shift 2 ;;
    --base)         BASE="$2"; shift 2 ;;
    -h|--help)
      grep -E '^# ' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$REPO" || -z "$TITLE" ]]; then
  echo "缺少必备参数 --repo / --title" >&2
  exit 2
fi

if [[ ! -d "$REPO/.git" ]]; then
  echo "$REPO 不是 git 仓库" >&2
  exit 2
fi

# --- 生成 change-id ---
if [[ -z "$CHANGE_ID" ]]; then
  DATE=$(date +%Y%m%d)
  SAFE=$(echo "$TITLE" | tr -c '[:alnum:]' '-' | sed 's/^-*//;s/-*$//')
  CHANGE_ID="${DATE}-001-${SAFE}"
fi

# --- 默认输出路径 ---
if [[ -z "$OUTPUT" ]]; then
  OUTPUT="$REPO/.harness/changes/$CHANGE_ID/test-plan.md"
fi

mkdir -p "$(dirname "$OUTPUT")"

# --- 备份 ---
if [[ -f "$OUTPUT" ]]; then
  cp "$OUTPUT" "$OUTPUT.bak.$(date +%s)"
  echo "已备份原文件到 $OUTPUT.bak.*" >&2
fi

# --- 收集改动 ---
DIFF_MD=$(bash "$FT_ROOT/scripts/collect_diff.sh" \
  --repo "$REPO" --base "$BASE" --author-only "$AUTHOR_ONLY" 2>/dev/null || true)

if [[ -z "$DIFF_MD" ]]; then
  DIFF_MD="_(未获取到改动，请手动填写)_"
fi

# --- 依赖 skill 探测 ---
# shellcheck source=resolve_skills.sh
source "$SCRIPT_DIR/resolve_skills.sh"
DB_QUERY_SH="$(resolve_skill_script db-query scripts/query.sh || true)"
LOG_SEARCH_SH="$(resolve_skill_script log-search scripts/log_search.sh || true)"
SKILLS_ROOT="${JOYCODE_SKILLS_DIR:-${HOME}/.joycode/skills}"
DB_QUERY_SH="${DB_QUERY_SH:-${SKILLS_ROOT}/db-query/scripts/query.sh}"
LOG_SEARCH_SH="${LOG_SEARCH_SH:-${SKILLS_ROOT}/log-search/scripts/log_search.sh}"
DEP_WARN=""
[[ ! -f "$DB_QUERY_SH"   ]] && DEP_WARN+="- ⚠️ db-query 未就绪：$DB_QUERY_SH 不存在，DB 快照/核对需手动执行"$'\n'
[[ ! -f "$LOG_SEARCH_SH" ]] && DEP_WARN+="- ⚠️ log-search 未就绪：$LOG_SEARCH_SH 不存在，失败根因需手动拉日志"$'\n'

TODAY=$(date +%Y-%m-%d)
HEAD_SHA=$(cd "$REPO" && git rev-parse --short HEAD)
BRANCH=$(cd "$REPO" && git rev-parse --abbrev-ref HEAD)
MY_NAME=$(cd "$REPO" && git config user.name || echo "")
MY_EMAIL=$(cd "$REPO" && git config user.email || echo "")

NOW_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > "$OUTPUT" <<EOF
# $TITLE 验证执行 handoff（$TODAY）

- **变更 ID**：$CHANGE_ID
- **项目**：$(basename "$REPO")
- **分支**：$BRANCH (HEAD sha: $HEAD_SHA)
- **负责人**：$MY_NAME <$MY_EMAIL>
- **验收人**：<待填>
- **验证环境**：<test / staging / prod / eone>
- **entry_kind**：<待 Stage 3 判定：http_openapi / http_and_jsf / jsf_only>
- **HTTP base URL**：<待填>
- **JSF 直连 host**：<待填；有 OpenApi 时不默认必填>

${DEP_WARN:+> 依赖 skill 探测：
$DEP_WARN
}

## 0. 断点续跑状态（唯一 SSOT）

> **禁止手工编辑本节 YAML**。所有更新必须通过 \`scripts/update_state.sh\` 原子写入。
> 新 Agent 加载本文档后，第一步必须读取本节 \`next_action\` 判断下一步动作。
> 详见 [resume-protocol.md]($FT_ROOT/references/resume-protocol.md)。

<!-- STATE:BEGIN -->
\`\`\`yaml
schema_version: 1
change_id: "$CHANGE_ID"
repo: "$(basename "$REPO")"
branch: "$BRANCH"
head_sha: "$HEAD_SHA"
created_at: "$NOW_ISO"
updated_at: "$NOW_ISO"
current_stage: stage1_collect
blocked_on: change_confirmed
gates:
  change_confirmed:
    status: pending
    at: null
    note: "改动清单已生成，待用户确认范围"
  scope_confirmed:
    status: pending
    at: null
    note: null
  impact_confirmed:
    status: pending
    at: null
    note: null
  plan_confirmed:
    status: pending
    at: null
    note: null
  execute_done:
    status: pending
    at: null
    note: null
  report_done:
    status: pending
    at: null
    note: null
runs: []
pending_cases: []
next_action:
  kind: ask_user
  prompt: "请确认 §1 改动清单是否完整？如需补充请指出遗漏点；确认后我将进入 §2 范围拆解。"
  stage: stage1_collect
  gate: change_confirmed
\`\`\`
<!-- STATE:END -->

## 0.1 使用说明
- 本文档同时是「测试方案」与「执行记录」，多轮验证按 runId 追加到 § 7，**不覆盖历史**。
- 所有调用按 entry_kind 选择 HTTP 或 JSF；DB 只读查询免二次确认；日志/DB 核对复用对应 skill。
- **每完成一个 Stage / 每跑完一个用例，必须通过 \`update_state.sh\` 写回 §0**（先写状态再动手）。
- 完整工作流：参见 [function-test SKILL.md]($FT_ROOT/SKILL.md)。

## 1. 改动清单
$DIFF_MD

## 2. 测试范围
> **闸门：范围确认**。列出必测点，等用户确认。

| # | 测试点 | 触发路径 | 必测 | 验收人 | 备注 |
|---|--------|----------|-----|--------|------|
| 1 | <待填> | <入口方法或场景> | ✅ | <待填> | |

## 3. 链路影响
### 3.1 <测试点 1>
- 入口：\`<class#method>\`
- 调用链：A → B → C
- DB 表：<table>（分片：<rule>）
- 缓存：<key-pattern>
- MQ：<topic>（生产/消费）
- 风险点：
  - <类别>：<描述>

## 4. 测试数据

### 4.1 数据集
| 用例 | 关键字段 | 说明 |
|------|----------|------|
| CASE-01 | ... | ... |

### 4.2 执行前快照
\`\`\`bash
bash $DB_QUERY_SH <app> <ds> <env> "<SELECT ...>"
\`\`\`

| 表 | 记录 | before |
|----|------|--------|
|    |      |        |

## 5. 执行方案

### 5.0 入口类型
- entry_kind：<http_openapi / http_and_jsf / jsf_only>
- HTTP path：<从 @OpenApi 解析，或 N/A>

### 5.1 HTTP（优先，若有 OpenApi/Controller）
- base URL：<http_base_url>
- 命令模板：见 [http-openapi-invoke.md]($FT_ROOT/references/http-openapi-invoke.md)

### 5.2 JSF 直连（仅 jsf_only 或 HTTP 降级）
- host：<ip:port>
- runId 前缀：\`$(date +%m%d%H%M)\`
- 命令模板：见 [jsf-direct-invoke.md]($FT_ROOT/references/jsf-direct-invoke.md)

## 6. 用例矩阵
| # | 用例 | 前置数据 | 步骤 | 预期 | 数据核对点 |
|---|------|----------|------|------|------------|
| 1 | ... | ... | ... | ... | ... |

## 7. 执行记录
### 7.1 Run <runId-1> — <yyyy-MM-dd HH:mm>
| # | 用例 | code | msg | 耗时 | traceId |
|---|------|------|-----|------|---------|

#### 事后快照对账
| 表 | before | after | diff | 预期 diff | 判定 |
|----|--------|-------|------|-----------|------|

## 8. 失败根因
_(如有不通过用例，此处填写详细根因链；参考 SKILL.md § 六 与 failure-report-template.md)_

## 9. 结论
- 通过用例：<N> / <total>
- 失败用例：<M>
- **处置**：
  - [ ] 开启修复 → bug-fix skill
  - [ ] 用户自行解决
EOF

echo "已生成：$OUTPUT"