#!/bin/bash
# 获取 systemCode 脚本
# 根据 appCode 获取对应的 systemCode
#
# 使用说明：
# - API 只有一套，不区分环境
# - 返回值统一去掉 -test 后缀，由 log_search.sh 根据环境决定是否添加

set -e

# ==================== 参数解析 ====================

APP_CODE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --appCode) APP_CODE="$2"; shift 2 ;;
        *) echo "未知参数: $1"; exit 1 ;;
    esac
done

# ==================== 参数校验 ====================

if [[ -z "${APP_CODE}" ]]; then
    echo '{"status": "error", "message": "缺少必要参数: --appCode"}' | jq .
    exit 1
fi

# ==================== API 调用 ====================

API_URL="http://origin-api-test-prod.origin-test-pro.svc.hc04.n.jd.local/api/origin_metadata/v1/resource/query_by_app?platform=jdos&appCode=${APP_CODE}"

# 调用 API
RESULT=$(curl -s -X GET "${API_URL}" \
    -H "accept: application/json" \
    -H "Content-Type: application/json" 2>&1)

# 检查 API 调用是否成功
CODE=$(echo "${RESULT}" | jq -r '.code // "error"')

if [[ "${CODE}" == "0" ]]; then
    SYSTEM_CODE=$(echo "${RESULT}" | jq -r '.data.systemCode // empty')
    SYSTEM_ALIAS=$(echo "${RESULT}" | jq -r '.data.systemAlias // empty')
    APP_ALIAS=$(echo "${RESULT}" | jq -r '.data.appAlias // empty')

    if [[ -n "${SYSTEM_CODE}" ]]; then
        # 统一去掉 -test 后缀，由 log_search.sh 根据环境决定是否添加
        if [[ "${SYSTEM_CODE}" == *-test ]]; then
            SYSTEM_CODE=$(echo "${SYSTEM_CODE}" | sed 's/-test$//')
        fi

        cat <<EOF
{
  "status": "success",
  "appCode": "${APP_CODE}",
  "systemCode": "${SYSTEM_CODE}",
  "systemAlias": "${SYSTEM_ALIAS}",
  "appAlias": "${APP_ALIAS}"
}
EOF
    else
        echo '{"status": "error", "message": "未找到对应的 systemCode"}' | jq .
    fi
else
    MESSAGE=$(echo "${RESULT}" | jq -r '.message // "API 调用失败"')
    echo "{\"status\": \"error\", \"message\": \"${MESSAGE}\"}" | jq .
fi