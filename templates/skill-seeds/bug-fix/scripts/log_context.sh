#!/bin/bash
# 日志上下文检索脚本 - 获取指定日志行的上下文
# 当第一个脚本的日志不足以排查问题时，使用此脚本获取更多上下文

set -e

# ==================== 参数解析 ====================

FILE=""
BASE_LINE_NUM=""
CONTEXT_NUM=100
CONTEXT_MODE=0
KEYWORD=""
PIN=""
ERP=""
ENV=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --file) FILE="$2"; shift 2 ;;
        --baseLineNum) BASE_LINE_NUM="$2"; shift 2 ;;
        --contextNum) CONTEXT_NUM="$2"; shift 2 ;;
        --contextMode) CONTEXT_MODE="$2"; shift 2 ;;
        --keyword) KEYWORD="$2"; shift 2 ;;
        --pin) PIN="$2"; shift 2 ;;
        --erp) ERP="$2"; shift 2 ;;
        --env) ENV="$2"; shift 2 ;;
        *) echo "未知参数: $1"; exit 1 ;;
    esac
done

# ==================== 参数校验 ====================

if [[ -z "${FILE}" ]]; then
    echo '{"status": "error", "message": "缺少必要参数: --file (日志文件路径)"}' | jq .
    exit 1
fi

if [[ -z "${BASE_LINE_NUM}" ]]; then
    echo '{"status": "error", "message": "缺少必要参数: --baseLineNum (基准行号)"}' | jq .
    exit 1
fi

if [[ -z "${PIN}" ]]; then
    echo '{"status": "error", "message": "缺少必要参数: --pin (请提供京东 ERP 账号)"}' | jq .
    exit 1
fi

if [[ -z "${ERP}" ]]; then
    ERP="${PIN}"
fi

# ==================== 环境配置 ====================

get_api_base_url() {
    local env="$1"
    case "${env}" in
        "test"|"") echo "http://tianwei-gateway.jdtest.local" ;;
        "staging"|"prod") echo "https://dongmonitor.jd.com" ;;
        *) echo "http://tianwei-gateway.jdtest.local" ;;
    esac
}

need_proxy_header() {
    local env="$1"
    case "${env}" in
        "test"|"") echo "false" ;;
        "staging"|"prod") echo "true" ;;
        *) echo "false" ;;
    esac
}

get_proxy_opts() {
    local env="$1"
    if [[ "$(need_proxy_header "${env}")" == "true" ]]; then
        echo '{"target":"http://tianwei-gateway.jd.local/","pathRewrite":{"/api/tianweiApi":""}}'
    else
        echo ""
    fi
}

# ==================== 调用日志上下文 API ====================

API_BASE=$(get_api_base_url "${ENV}")
NEED_PROXY=$(need_proxy_header "${ENV}")

PAYLOAD=$(cat <<EOF
{
    "file": "${FILE}",
    "contextMode": ${CONTEXT_MODE},
    "contextNum": ${CONTEXT_NUM},
    "baseLineNum": ${BASE_LINE_NUM},
    "keyword": "${KEYWORD}",
    "erp": "${ERP}",
    "showPlain": false
}
EOF
)

if [[ "${NEED_PROXY}" == "true" ]]; then
    CONTEXT_URL="${API_BASE}/api/tianweiApi/log-history/v1/log/context2"
else
    CONTEXT_URL="${API_BASE}/log-history/v1/log/context2"
fi

if [[ "${NEED_PROXY}" == "true" ]]; then
    PROXY_OPTS=$(get_proxy_opts "${ENV}")
    RESULT=$(curl -s -X POST "${CONTEXT_URL}" \
        -H "accept: application/json" \
        -H "content-type: application/json;charset=UTF-8" \
        -H "pin: ${PIN}" \
        -H "token: token-origin" \
        -H "x-proxy-opts: ${PROXY_OPTS}" \
        -d "${PAYLOAD}" 2>&1)
else
    RESULT=$(curl -s -X POST "${CONTEXT_URL}" \
        -H "accept: application/json" \
        -H "content-type: application/json;charset=UTF-8" \
        -H "pin: ${PIN}" \
        -H "token: token-origin" \
        -d "${PAYLOAD}" 2>&1)
fi

# ==================== 返回结果 ====================

CODE=$(echo "${RESULT}" | jq -r '.code // 0')

if [[ "${CODE}" == "200" ]]; then
    # data 可能是数组或对象
    DATA_TYPE=$(echo "${RESULT}" | jq '.data | type')

    if [[ "${DATA_TYPE}" == '"array"' ]]; then
        LOGS=$(echo "${RESULT}" | jq '.data')
    else
        LOGS=$(echo "${RESULT}" | jq '.data.logs // []')
    fi

    LOG_COUNT=$(echo "${LOGS}" | jq 'length')

    if [[ ${LOG_COUNT} -gt 0 ]]; then
        cat <<EOF
{"status": "success", "file": "${FILE}", "baseLineNum": ${BASE_LINE_NUM}, "contextNum": ${CONTEXT_NUM}, "logs": ${LOGS}, "count": ${LOG_COUNT}}
EOF
    else
        echo '{"status": "not_found", "file": "'"${FILE}"'", "baseLineNum": '"${BASE_LINE_NUM}"', "message": "未找到上下文日志"}'
    fi
else
    MESSAGE=$(echo "${RESULT}" | jq -r '.msg // "获取上下文日志失败"')
    echo '{"status": "error", "file": "'"${FILE}"'", "baseLineNum": '"${BASE_LINE_NUM}"', "message": "'"${MESSAGE}"'"}'
fi