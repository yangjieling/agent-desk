#!/usr/bin/env bash
# check_dbs_datasource.sh - 兼容层：转发到 db-query skill
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=resolve_tools.sh
source "$SCRIPT_DIR/resolve_tools.sh"

TARGET="$(resolve_db_query_script scripts/query-dbs.sh || true)"
if [[ -z "$TARGET" || ! -f "$TARGET" ]]; then
  echo '{"status":"error","message":"db-query 未安装：请先 hb install db-query"}'
  exit 2
fi

exec bash "$TARGET" "$@"
