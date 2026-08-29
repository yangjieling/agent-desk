#!/usr/bin/env bash
# resolve_skills.sh - 解析 ~/.joycode/skills 下的 skill 脚本路径
#
# 用法（source 后调用）:
#   source "$(dirname "$0")/resolve_skills.sh"
#   DB_QUERY_SH="$(resolve_skill_script db-query scripts/query.sh)"
#
# 环境变量:
#   JOYCODE_SKILLS_DIR  覆盖默认 ~/.joycode/skills

SKILLS_ROOT="${JOYCODE_SKILLS_DIR:-${HOME}/.joycode/skills}"

resolve_skill_script() {
  local skill="$1"
  local rel="$2"
  local candidate="${SKILLS_ROOT}/${skill}/${rel}"
  if [[ -f "$candidate" ]]; then
    printf '%s' "$candidate"
    return 0
  fi

  # 源码树内联开发：function-test 与 db-query 等同属 .joycode/skills
  local here="${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}"
  local fn_root
  fn_root="$(cd "$(dirname "$here")/.." && pwd)"
  local sibling="${fn_root}/../${skill}/${rel}"
  if [[ -f "$sibling" ]]; then
    printf '%s' "$(cd "$(dirname "$sibling")" && pwd)/$(basename "$sibling")"
    return 0
  fi

  return 1
}

resolve_skill_dir() {
  local skill="$1"
  local candidate="${SKILLS_ROOT}/${skill}"
  if [[ -d "$candidate" ]]; then
    printf '%s' "$candidate"
    return 0
  fi
  local here="${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}"
  local fn_root
  fn_root="$(cd "$(dirname "$here")/.." && pwd)"
  local sibling="${fn_root}/../${skill}"
  if [[ -d "$sibling" ]]; then
    printf '%s' "$(cd "$sibling" && pwd)"
    return 0
  fi
  return 1
}
