#!/bin/bash
# check_ducc_profiles.sh - 查询 DUCC 应用的所有 profile
#
# 用法: bash check_ducc_profiles.sh <appId>
#
# 用途:
#   Bug 分析阶段用于列出应用下所有 namespace/config/profile 三元组，
#   便于 AI 根据问题涉及的模块（application/mq/scheduler/database ...）
#   定位到应查询的 profile，再调用 check_ducc_config_item.sh 获取具体值。
#
# 参数:
#   appId  DUCC 应用 ID（从 check_ducc_app.sh 输出的 appId）
#
# 输出（stdout, JSON）:
#   {
#     "status": "success",
#     "profiles": [
#       {"configCode":"application","namespaceId":"21263","configId":"3063931","profileId":"3554183","profileCode":"prod","itemCount":42,"owner":"..."}
#     ]
#   }
#
# 退出码:
#   0 = 查询成功
#   1 = 查询失败
#   2= 参数缺失 / token 不可用

APP_ID="${1:-}"

if [ -z "$APP_ID" ]; then
    echo '{"status":"error","message":"用法: check_ducc_profiles.sh <appId>"}' | jq .
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

RESPONSE=$(curl -sS "http://console.ducc.jd.com/admin/v2/application/$APP_ID/profiles?size=50&page=1" \
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

data = resp.get('data', {}) or {}
records = data.get('result', []) or []
profiles = []
for r in records:
    ns = r.get('namespace', {}) or {}
    cfg = r.get('configuration', {}) or {}
    pf = r.get('profile', {}) or {}
    profiles.append({
        "namespaceCode": ns.get('code',''),
        "namespaceId": str(ns.get('id','')),
        "configCode": cfg.get('code',''),
        "configName": cfg.get('name',''),
        "configId": str(cfg.get('id','')),
        "profileCode": pf.get('code',''),
        "profileId": str(pf.get('id','')),
        "itemCount": r.get('itemCount', 0),
        "owner": r.get('owner',''),
    })

if not profiles:
    print(json.dumps({"status":"not_found","message":"该应用下没有 profile"}))
    sys.exit(1)

print(json.dumps({"status":"success","profiles": profiles}, ensure_ascii=False))
PYEOF