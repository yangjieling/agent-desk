#!/usr/bin/env bash
# resolve_tools.sh - 解析 bug-fix / db-query 脚本目录
#
# 用法（source 后调用）:
#   source "$(dirname "$0")/resolve_tools.sh"
#   BUG_SCRIPTS="$(resolve_bug_fix_scripts)"
#   DB_QUERY_SH="$(resolve_db_query_script query.sh)"

resolve_bug_fix_scripts() {
  local dir="${BUG_FIX_DIR:-}"
  if [[ -n "$dir" && -d "$dir/scripts" ]]; then
    printf '%s' "$dir/scripts"
    return 0
  fi
  local candidates=(
    "${JOYCODE_SKILLS_DIR:-$HOME/.joycode/skills}/bug-fix/scripts"
    ".joycode/skills/bug-fix/scripts"
    "$HOME/.harness/skills/bug-fix/scripts"
  )
  local c
  for c in "${candidates[@]}"; do
    if [[ -d "$c" ]]; then
      printf '%s' "$(cd "$c" && pwd)"
      return 0
    fi
  done
  return 1
}

resolve_db_query_script() {
  local rel="${1:-scripts/query.sh}"
  local skill_root="${JOYCODE_SKILLS_DIR:-$HOME/.joycode/skills}/db-query"
  local candidate="$skill_root/$rel"
  if [[ -f "$candidate" ]]; then
    printf '%s' "$candidate"
    return 0
  fi
  local here="${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}"
  local bug_fix_root sibling
  bug_fix_root="$(cd "$(dirname "$here")/.." && pwd)"
  sibling="$bug_fix_root/../db-query/$rel"
  if [[ -f "$sibling" ]]; then
    printf '%s' "$(cd "$(dirname "$sibling")" && pwd)/$(basename "$sibling")"
    return 0
  fi
  return 1
}
