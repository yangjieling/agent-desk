#!/usr/bin/env bash
# collect_diff.sh - 收集当前分支 + 当前开发者的净改动
#
# 用法：
#   bash collect_diff.sh --repo <path> [--base origin/master] [--author-only true]
#                        [--output <json>] [--format json|md]
#
# 产出：
#   - 默认 stdout 打印一段 Markdown 概览
#   - 传 --output <file> 时同步落盘（JSON 或 Markdown）
set -euo pipefail

REPO=""
BASE="origin/master"
AUTHOR_ONLY="true"
OUTPUT=""
FORMAT="md"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)         REPO="$2"; shift 2 ;;
    --base)         BASE="$2"; shift 2 ;;
    --author-only)  AUTHOR_ONLY="$2"; shift 2 ;;
    --output)       OUTPUT="$2"; shift 2 ;;
    --format)       FORMAT="$2"; shift 2 ;;
    -h|--help)
      grep -E '^# ' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$REPO" ]]; then
  echo "缺少 --repo 参数" >&2
  exit 2
fi

if [[ ! -d "$REPO/.git" ]]; then
  echo "$REPO 不是 git 仓库" >&2
  exit 2
fi

cd "$REPO"

# --- 拉最新 base ---
BASE_REMOTE="${BASE%%/*}"
BASE_BRANCH="${BASE#*/}"
if [[ "$BASE" == */* ]]; then
  git fetch --no-tags -q "$BASE_REMOTE" "$BASE_BRANCH" 2>/dev/null || true
fi

# 校验 base 存在
if ! git rev-parse --verify --quiet "$BASE" >/dev/null; then
  echo "base 分支不存在: $BASE" >&2
  exit 3
fi

HEAD_SHA=$(git rev-parse --short HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
MY_EMAIL=$(git config user.email || echo "")
MY_NAME=$(git config user.name || echo "")

if [[ -z "$MY_EMAIL" ]]; then
  echo "警告：本地 git 未配置 user.email，无法过滤开发者" >&2
fi

# --- 收集 commit ---
ALL_COMMITS=$(git log "$BASE..HEAD" --no-merges --pretty=format:'%h|%ci|%an <%ae>|%s' || true)
MY_COMMITS=""
OTHER_COMMITS=""

if [[ -n "$ALL_COMMITS" ]]; then
  while IFS= read -r line; do
    email=$(echo "$line" | awk -F'|' '{print $3}' | sed -E 's/.*<([^>]+)>.*/\1/')
    if [[ "$email" == "$MY_EMAIL" ]]; then
      MY_COMMITS+="$line"$'\n'
    else
      OTHER_COMMITS+="$line"$'\n'
    fi
  done <<< "$ALL_COMMITS"
fi

MY_COUNT=$(echo -n "$MY_COMMITS" | grep -c . || true)
OTHER_COUNT=$(echo -n "$OTHER_COMMITS" | grep -c . || true)

# --- 收集文件变更 ---
FILES=$(git diff --name-status -M "$BASE...HEAD" || true)

# --- 归类 ---
classify() {
  local f="$1"
  case "$f" in
    *api*/src/main/*|*-api/*)            echo "API 契约" ;;
    *handler*|*command*|*Handler*|*Command*) echo "Handler / 命令处理" ;;
    *mapper*|*Mapper*|*/dao/*|*mybatis*|*resources/mapper*) echo "数据访问" ;;
    *service*|*Service*|*manager*|*Manager*) echo "业务服务" ;;
    *consumer*|*listener*|*Consumer*|*Listener*) echo "MQ 消费" ;;
    *controller*|*Controller*|*rest*)     echo "HTTP 入口" ;;
    *resources/*.xml|*.yaml|*.yml|*.properties) echo "配置" ;;
    *test*|*Test*|src/test/*)             echo "测试代码" ;;
    *)                                    echo "其他" ;;
  esac
}

# macOS 系统 bash 3.2 不支持关联数组，改用「平行文件 buffer」
# 每个模块一个 tmp 文件，最后再汇总输出
BUF_DIR=$(mktemp -d "${TMPDIR:-/tmp}/collect-diff.XXXXXX")
trap 'rm -rf "$BUF_DIR"' EXIT

mod_slug() {
  # 将中文/空格模块名映射为文件安全 slug
  case "$1" in
    "API 契约")            echo "01-api" ;;
    "Handler / 命令处理")  echo "02-handler" ;;
    "业务服务")            echo "03-service" ;;
    "数据访问")            echo "04-dao" ;;
    "HTTP 入口")           echo "05-http" ;;
    "MQ 消费")             echo "06-mq" ;;
    "配置")                echo "07-config" ;;
    "测试代码")            echo "08-test" ;;
    *)                     echo "09-other" ;;
  esac
}

while IFS=$'\t' read -r status file rename_target; do
  [[ -z "$file" ]] && continue
  real="$file"
  [[ -n "${rename_target:-}" ]] && real="$rename_target"
  mod=$(classify "$real")
  echo "$status $real" >> "$BUF_DIR/$(mod_slug "$mod")"
done <<< "$FILES"

buf_read() { # $1=模块名
  local f="$BUF_DIR/$(mod_slug "$1")"
  [[ -f "$f" ]] && cat "$f" || true
}

# --- 输出 ---
render_md() {
  cat <<EOF
# 改动清单

- **项目**：$(basename "$REPO")
- **分支**：$BRANCH (HEAD sha: $HEAD_SHA)
- **Base**：$BASE
- **开发者**：$MY_NAME <$MY_EMAIL>
- **本人 commit**：$MY_COUNT
- **他人 commit**：$OTHER_COUNT

## Commits（本人）
| SHA | 时间 | 主题 |
|-----|------|------|
EOF
  if [[ -n "$MY_COMMITS" ]]; then
    while IFS='|' read -r sha time author subject; do
      [[ -z "$sha" ]] && continue
      echo "| $sha | $time | ${subject//|/\\|} |"
    done <<< "$MY_COMMITS"
  else
    echo "| _(无)_ |  |  |"
  fi

  if [[ "$OTHER_COUNT" -gt 0 ]]; then
    cat <<EOF

## ⚠️ Commits（他人，需确认）
| SHA | 时间 | 作者 | 主题 |
|-----|------|------|------|
EOF
    while IFS='|' read -r sha time author subject; do
      [[ -z "$sha" ]] && continue
      echo "| $sha | $time | ${author//|/\\|} | ${subject//|/\\|} |"
    done <<< "$OTHER_COMMITS"
    echo ""
    echo "> **闸门确认**：HEAD 包含 $OTHER_COUNT 条非本人 commit，是否一并纳入测试范围？"
  fi

  echo ""
  echo "## 文件变更（按模块归类）"
  for mod in "API 契约" "Handler / 命令处理" "业务服务" "数据访问" "HTTP 入口" "MQ 消费" "配置" "测试代码" "其他"; do
    files="$(buf_read "$mod")"
    [[ -z "$files" ]] && continue
    echo ""
    echo "### $mod"
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      echo "- $line"
    done <<< "$files"
  done
}

render_json() {
  # 把 buffer 目录、commits 内容通过 env 传给 python
  export J_NAME="$MY_NAME" J_EMAIL="$MY_EMAIL" J_BRANCH="$BRANCH"
  export J_SHA="$HEAD_SHA" J_BASE="$BASE" J_REPO="$REPO"
  export J_MY_COMMITS="$MY_COMMITS" J_OTHER_COMMITS="$OTHER_COMMITS"
  export J_FILES="$FILES"

  python3 - <<'PY'
import json, os
def parse_commits(text):
    out = []
    for line in text.splitlines():
        if not line.strip(): continue
        parts = line.split("|", 3)
        if len(parts) < 4: continue
        sha, time, author, subject = parts
        out.append({"sha": sha, "time": time, "author": author, "subject": subject})
    return out

def parse_files(text):
    out = []
    for line in text.splitlines():
        if not line.strip(): continue
        parts = line.split("\t")
        status = parts[0]
        path   = parts[-1]  # rename 时取目标
        out.append({"status": status, "path": path})
    return out

data = {
  "repo":   os.path.basename(os.environ["J_REPO"]),
  "branch": os.environ["J_BRANCH"],
  "head":   os.environ["J_SHA"],
  "base":   os.environ["J_BASE"],
  "author": {"name": os.environ["J_NAME"], "email": os.environ["J_EMAIL"]},
  "my_commits":    parse_commits(os.environ.get("J_MY_COMMITS","")),
  "other_commits": parse_commits(os.environ.get("J_OTHER_COMMITS","")),
  "files":         parse_files(os.environ.get("J_FILES","")),
}
print(json.dumps(data, ensure_ascii=False, indent=2))
PY
}

OUT=""
if [[ "$FORMAT" == "json" ]]; then
  OUT="$(render_json)"
else
  OUT="$(render_md)"
fi

if [[ -n "$OUTPUT" ]]; then
  mkdir -p "$(dirname "$OUTPUT")"
  echo "$OUT" > "$OUTPUT"
  echo "写入 $OUTPUT" >&2
else
  echo "$OUT"
fi