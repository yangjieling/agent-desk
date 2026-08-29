#!/bin/bash
# check_ducc_config_item.sh - 查询 DUCC 配置项值（Bug 分析核心工具）
#
# 用法:
#   bash check_ducc_config_item.sh <namespaceId> <configId> <profileId> <itemName>
#
# 用途:
#   Bug 排查时验证"某个配置项当前实际生效值"，比如：
#     - 限流阈值、开关是否打开
#     - 白名单/黑名单是否包含目标 pin
#     - 降级开关状态
#     - 数据源/连接串配置
#   支持模糊搜索 itemName（后端接口即为 name 前缀匹配）。
#
# 参数:
#   namespaceId / configId / profileId  由 check_ducc_profiles.sh 输出的三元组
#   itemName                            配置项 key 或前缀
#
# 输出（stdout, JSON）:
#   {
#     "status": "success",
#     "total": 3,
#     "items": [
#       {"key":"...","value":"完整值","description":"...","isReleased":true,"updateBy":"erp"}
#     ]
#   }
#
# 退出码:
#   0 = 查询成功且至少 1 条
#   1 = 未找到 / 接口失败
#   2 = 参数缺失 / token 不可用

NS_ID="${1:-}"
CONFIG_ID="${2:-}"
PROFILE_ID="${3:-}"
ITEM_NAME="${4:-}"

if [ -z "$NS_ID" ] || [ -z "$CONFIG_ID" ] || [ -z "$PROFILE_ID" ] || [ -z "$ITEM_NAME" ]; then
    echo '{"status":"error","message":"用法: check_ducc_config_item.sh <namespaceId> <configId> <profileId> <itemName>"}' | jq .
    exit 2
fi

TOKEN_FILE="$HOME/.jdtoken/jd-sso-token.json"

if [ ! -f "$TOKEN_FILE" ]; then
    TOKEN_FILE="$HOME/.joyclaw/workspace/jd-sso-token.json"
fi

if [ ! -f "$TOKEN_FILE" ]; then
    echo '{"status":"error","message":"未找到 SSO 登录态，请先通过 jd-token-tool skill 获取"}' | jq .
    exit 2
fi

SSO_TOKEN=$(python3 -c "import json; print(json.load(open('$TOKEN_FILE'))['sso.jd.com'])" 2>/dev/null)

if [ -z "$SSO_TOKEN" ]; then
    echo '{"status":"error","message":"SSO token 解析失败，请重新获取"}' | jq .
    exit 2
fi

# 对 itemName 做 URL 编码，避免特殊字符导致查询失败
ITEM_ENC=$(python3 -c "import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))" "$ITEM_NAME")

URL="http://console.ducc.jd.com/admin/v2/namespace/$NS_ID/config/$CONFIG_ID/profile/$PROFILE_ID/items/search?size=50&page=1&fromRelease=false&orderField=updateTime&desc=desc&name=$ITEM_ENC"

RESPONSE=$(curl -sS "$URL" -H "Cookie: sso.jd.com=$SSO_TOKEN" 2>/dev/null)

if [ -z "$RESPONSE" ]; then
    echo '{"status":"error","message":"DUCC 接口请求失败（网络或 token 过期）"}' | jq .
    exit 1
fi

echo "$RESPONSE" | python3 <<'PYEOF'
import sys, json
try:
    resp = json.load(sys.stdin)
except Exception as e:
    print(json.dumps({"status":"error","message":f"解析响应失败: {e}"}))
    sys.exit(1)

if resp.get('code') != 200:
    print(json.dumps({"status":"error","message":f"接口异常 code={resp.get('code')}"}))
    sys.exit(1)

records = resp.get('data', []) or []
total = resp.get('pagination',{}).get('totalRecord', len(records))
items = []
for r in records:
    ub = r.get('updateBy', {}) or {}
    items.append({
        "key": r.get('key',''),
        "value": r.get('value',''),
        "description": r.get('description',''),
        "isReleased": r.get('isReleased', 0) == 1,
        "updateBy": ub.get('code','') if isinstance(ub, dict) else '',
        "updateTime": r.get('updateTime',''),
    })

if not items:
    print(json.dumps({"status":"not_found","total":0,"items":[]}, ensure_ascii=False))
    sys.exit(1)

print(json.dumps({"status":"success","total": total, "items": items}, ensure_ascii=False))
PYEOF