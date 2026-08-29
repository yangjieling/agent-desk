#!/usr/bin/env bash
# update_state.sh - 原子更新 test-plan.md 顶部的 §0 状态块
#
# 用法示例：
#   bash update_state.sh --plan /path/to/test-plan.md \
#     --set current_stage=stage5_execute \
#     --set-gate scope_confirmed=passed:"覆盖用例1/2/3" \
#     --append-run '{"run_id":"08181530-002","case_id":3,"result":"fail"}' \
#     --append-pending-case '{"id":3,"name":"报损取消","status":"pending"}' \
#     --remove-pending-case-id 2 \
#     --set-blocked-on failure_disposal \
#     --set-next-action '{"kind":"ask_user","prompt":"选择开启修复或自解决"}'
#
# 设计：
#   - bash 只做参数收集，YAML 读/合并/写全部由内嵌 Python + PyYAML 处理
#   - flock 保护整个读改写周期，防止并发覆盖
#   - 原子性：写临时文件 → shutil.move 覆盖，失败绝不损坏原文件
#   - 状态块用 <!-- STATE:BEGIN --> / <!-- STATE:END --> 定位，无需依赖标题
set -euo pipefail

PLAN=""
SET_KVS=()
SET_GATES=()
APPEND_RUNS=()
APPEND_PENDING=()
REMOVE_PENDING_IDS=()
NEXT_ACTION=""
BLOCKED_ON="__UNSET__"
INIT_JSON=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --plan)                   PLAN="$2"; shift 2 ;;
    --set)                    SET_KVS+=("$2"); shift 2 ;;
    --set-gate)               SET_GATES+=("$2"); shift 2 ;;
    --append-run)             APPEND_RUNS+=("$2"); shift 2 ;;
    --append-pending-case)    APPEND_PENDING+=("$2"); shift 2 ;;
    --remove-pending-case-id) REMOVE_PENDING_IDS+=("$2"); shift 2 ;;
    --set-next-action)        NEXT_ACTION="$2"; shift 2 ;;
    --set-blocked-on)         BLOCKED_ON="$2"; shift 2 ;;
    --init-json)              INIT_JSON="$2"; shift 2 ;;
    -h|--help)
    grep -E '^# ' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ -z "$PLAN" ]]   && { echo "缺少 --plan" >&2; exit 2; }
[[ ! -f "$PLAN" ]] && { echo "文件不存在: $PLAN" >&2; exit 2; }

command -v python3 >/dev/null 2>&1 || { echo "需要 python3" >&2; exit 3; }
python3 -c "import yaml" 2>/dev/null || { echo "需要 PyYAML: pip3 install pyyaml" >&2; exit 3; }

# 锁文件放到系统 tmp 目录，避免污染工作目录
LOCK_KEY=$(python3 -c "import hashlib,sys;print(hashlib.md5(sys.argv[1].encode()).hexdigest())" "$PLAN")
LOCK_FILE="${TMPDIR:-/tmp}/function-test-${LOCK_KEY}.lock"
exec 9>"$LOCK_FILE"
if ! flock -w 30 9; then
  echo "获取文件锁超时（30s）：$LOCK_FILE" >&2
  exit 4
fi

# 通过 env 传递数组（\x1f 分隔），避免与 JSON 内容冲突
export P_PLAN="$PLAN"
export P_SET_KVS=$(IFS=$'\x1f'; echo "${SET_KVS[*]-}")
export P_SET_GATES=$(IFS=$'\x1f'; echo "${SET_GATES[*]-}")
export P_APPEND_RUNS=$(IFS=$'\x1f'; echo "${APPEND_RUNS[*]-}")
export P_APPEND_PENDING=$(IFS=$'\x1f'; echo "${APPEND_PENDING[*]-}")
export P_REMOVE_PENDING=$(IFS=$'\x1f'; echo "${REMOVE_PENDING_IDS[*]-}")
export P_NEXT_ACTION="$NEXT_ACTION"
export P_BLOCKED_ON="$BLOCKED_ON"
export P_INIT_JSON="$INIT_JSON"

python3 - <<'PY'
import json, os, re, sys, tempfile, shutil
from datetime import datetime, timezone, timedelta
import yaml

PLAN = os.environ["P_PLAN"]

def now_iso():
    tz = timezone(timedelta(hours=8))
    return datetime.now(tz).replace(microsecond=0).isoformat()

def env_list(name):
    raw = os.environ.get(name, "")
    if not raw:
        return []
    return [x for x in raw.split("\x1f") if x != ""]

def split_kv(s, sep="="):
    if sep not in s:
        raise ValueError(f"bad kv: {s}")
    k, v = s.split(sep, 1)
    return k.strip(), v.strip()

def cast(v):
    if v.lower() in ("null", "none", ""):
        return None
    if v.lower() == "true":  return True
    if v.lower() == "false": return False
    try:    return int(v)
    except: return v

with open(PLAN, "r", encoding="utf-8") as f:
    text = f.read()

# 用完整锚定符定位 STATE 块（含尾巴 -->，避免误匹配 EN dash 变体）
BEGIN_RE = re.compile(r"<!--\s*STATE:BEGIN.*?-->", re.DOTALL)
END_RE   = re.compile(r"<!--\s*STATE:END\s*-->")

bm = BEGIN_RE.search(text)
em = END_RE.search(text, bm.end()) if bm else None

init_json = os.environ.get("P_INIT_JSON") or ""

if not bm or not em:
    if not init_json:
        print("状态块不存在；仅允许通过 gen_test_plan.sh 首次创建（--init-json）", file=sys.stderr)
        sys.exit(5)
    state = json.loads(init_json)
    before = text.rstrip() + "\n\n"
    after  = ""
else:
    inner = text[bm.end():em.start()]
    ym = re.search(r"```ya?ml\s*\n(.*?)\n```", inner, re.DOTALL)
    if not ym:
        print("状态块内未找到 yaml 代码块", file=sys.stderr); sys.exit(5)
    try:
        state = yaml.safe_load(ym.group(1)) or {}
    except yaml.YAMLError as e:
        print(f"YAML 解析失败: {e}", file=sys.stderr); sys.exit(5)
    before = text[:bm.start()]
    after  = text[em.end():]

# --- 应用修改 ---

# --set key=value （支持点号路径 a.b.c）
for kv in env_list("P_SET_KVS"):
    k, v = split_kv(kv)
    keys = k.split(".")
    d = state
    for kk in keys[:-1]:
        d = d.setdefault(kk, {})
    d[keys[-1]] = cast(v)

# --set-gate name=status[:note]
for gs in env_list("P_SET_GATES"):
    name, rest = split_kv(gs)
    if ":"in rest:
        status, note = rest.split(":", 1)
        note = note.strip() or None
    else:
        status, note = rest, None
    gates = state.setdefault("gates", {})
    gates[name] = {"status": status.strip(), "at": now_iso(), "note": note}

# --append-run '{...}'
runs = state.setdefault("runs", [])
for r in env_list("P_APPEND_RUNS"):
    obj = json.loads(r)
    obj.setdefault("at", now_iso())
    runs.append(obj)

# --append-pending-case '{...}'
pend = state.setdefault("pending_cases", [])
for p in env_list("P_APPEND_PENDING"):
    pend.append(json.loads(p))

# --remove-pending-case-id  同时兼容 id / case_id 两种字段名
for rid in env_list("P_REMOVE_PENDING"):
    try:    rid_i = int(rid)
    except: rid_i = rid
    def _keep(c):
        cid = c.get("id", c.get("case_id"))
        return cid not in (rid, rid_i)
    state["pending_cases"] = [c for c in pend if _keep(c)]
    pend = state["pending_cases"]

# --set-blocked-on
b = os.environ.get("P_BLOCKED_ON", "__UNSET__")
if b != "__UNSET__":
    state["blocked_on"] = None if b.lower() in ("null","none","") else b

# --set-next-action
na = os.environ.get("P_NEXT_ACTION", "")
if na:
    state["next_action"] = json.loads(na)

state["updated_at"] = now_iso()
state.setdefault("schema_version", 1)

# --- 序列化并写回 ---
yaml_body = yaml.safe_dump(
    state, allow_unicode=True, sort_keys=False, default_flow_style=False
)

block = (
    "<!-- STATE:BEGIN -->\n"
    "```yaml\n" + yaml_body + "```\n"
    "<!-- STATE:END -->"
)

new_text = before + block + after

# 原子写入
d = os.path.dirname(PLAN) or "."
fd, tmp = tempfile.mkstemp(prefix=".plan.", suffix=".tmp", dir=d)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(new_text)
    shutil.move(tmp, PLAN)
except Exception:
    if os.path.exists(tmp): os.remove(tmp)
    raise

print(f"✅ 状态已更新: stage={state.get('current_stage')} "
      f"blocked_on={state.get('blocked_on')} "
      f"next={ (state.get('next_action') or {}).get('kind') }")
PY