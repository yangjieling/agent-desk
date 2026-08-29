#!/bin/bash
# check_ducc_app.sh - 查询 DUCC 应用注册信息（Bug 分析阶段使用）
#
# 用法: bash check_ducc_app.sh <appCode>
#
# 用途:
#   Bug 分析阶段确认应用是否在 DUCC 配置中心注册，并拿到 appId，
#   供后续查询 profile 与具体配置项，为定位"配置驱动的异常"提供依据。
#
# 参数:
#   appCode  应用名称（例如 yzt-base-pay-gateway）
#
# 输出（stdout, JSON）:
#   { "status": "success", "appId": "...", "appCode": "...", "records": [...] }
#   { "status": "not_found" | "error", "message": "..." }
#
# 退出码:
#   0 = 查询成功
#   1 = 查询失败或应用未注册
#   2 = 参数缺失 / token 不可用

APP_CODE="${1:-}"

if [ -z "$APP_CODE" ]; then
    echo '{"status":"error","message":"用法: check_ducc_app.sh <appCode>"}' | jq .
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

RESPONSE=$(curl -sS "http://console.ducc.jd.com/v1/applications/search?size=10&page=1&appCode=$APP_CODE&searchType=ALL&filter=all" \
  -H "Cookie: sso.jd.com=$SSO_TOKEN" 2>/dev/null)

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
out = []
for r in records:
    owner = r.get('owner', {})
    out.append({
        "appId": r.get('id',''),
        "appCode": r.get('code',''),
        "appName": r.get('name',''),
        "system": r.get('system',''),
        "department": r.get('department',''),
        "owner": owner.get('code','') if isinstance(owner, dict) else '',
    })

if not out:
    print(json.dumps({"status":"not_found","message":"DUCC 未找到该应用","appCode": ""}))
    sys.exit(1)

first = out[0]
print(json.dumps({
    "status": "success",
    "appId": first["appId"],
    "appCode": first["appCode"],
    "records": out,
}, ensure_ascii=False))
PYEOF