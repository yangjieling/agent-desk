#!/bin/bash
# 日志检索脚本 - 纯粹的 API 调用工具
# 所有参数处理逻辑由 AI Agent 完成

# ==================== 重试和错误处理配置 ====================

MAX_RETRIES=2
RETRY_DELAY=2

# ==================== 错误处理函数 ====================

# 友好的错误输出
error_exit() {
    local message="$1"
    echo "{\"status\": \"error\", \"message\": \"${message}\"}" | jq .
    exit 1
}

# 网络错误检测
is_network_error() {
    local response="$1"
    # 检测常见的网络错误
    echo "$response" | grep -qiE "(connection refused|timeout|no route to host|could not resolve|network is unreachable|curl:)" && return 0
    return 1
}

# 截断检测
is_log_truncated() {
    local logs="$1"
    if [[ -z "$logs" ]] || [[ "$logs" == "[]" ]]; then
        return 1
    fi
    # 检测日志是否被截断：最后一行不以换行符结尾或包含"..."等截断标记
    local last_line=$(echo "$logs" | jq -r '.[-1].content // empty' 2>/dev/null)
    echo "$last_line" | grep -qE "\.\.\.$|\[truncated\]" && return 0
    # 检测是否以不完整的行结尾
    echo "$last_line" | grep -qvE "\.$|log|error|exception" && [[ ${#last_line} -gt 100 ]] && return 0
    return 1
}

# ==================== 带重试的 API 调用 ====================

# 带重试的 GET 请求
curl_get_with_retry() {
    local url="$1"
    local headers="$2"
    local attempt=0
    local result=""

    while [[ $attempt -lt $MAX_RETRIES ]]; do
        attempt=$((attempt + 1))

        if [[ -n "$headers" ]]; then
            result=$(curl -s -w "\n%{http_code}" -X GET "$url" $headers 2>&1)
        else
            result=$(curl -s -w "\n%{http_code}" -X GET "$url" 2>&1)
        fi

        local http_code=$(echo "$result" | tail -1)
        local response_body=$(echo "$result" | sed '$d')

        # 检查网络错误
        if is_network_error "$response_body"; then
            if [[ $attempt -lt $MAX_RETRIES ]]; then
                sleep $RETRY_DELAY
                continue
            else
                echo "{\"status\": \"network_error\", \"message\": \"网络请求失败，请检查网络连接\", \"attempts\": ${attempt}}" | jq .
                exit 1
            fi
        fi

        # 检查 HTTP 状态码
        if [[ "$http_code" != "200" ]]; then
            if [[ $attempt -lt $MAX_RETRIES ]]; then
                sleep $RETRY_DELAY
                continue
            else
                echo "{\"status\": \"http_error\", \"message\": \"API 请求失败 (HTTP ${http_code})\", \"attempts\": ${attempt}, \"response\": ${response_body:0:500}}" | jq .
                exit 1
            fi
        fi

        echo "$response_body"
        return 0
    done
}

# 带重试的 POST 请求
curl_post_with_retry() {
    local url="$1"
    local payload="$2"
    local headers="$3"
    local attempt=0
    local result=""

    while [[ $attempt -lt $MAX_RETRIES ]]; do
        attempt=$((attempt + 1))

        if [[ -n "$headers" ]]; then
            result=$(curl -s -w "\n%{http_code}" -X POST "$url" -H "accept: application/json" -H "content-type: application/json;charset=UTF-8" $headers -d "$payload" 2>&1)
        else
            result=$(curl -s -w "\n%{http_code}" -X POST "$url" -H "accept: application/json" -H "content-type: application/json;charset=UTF-8" -d "$payload" 2>&1)
        fi

        local http_code=$(echo "$result" | tail -1)
        local response_body=$(echo "$result" | sed '$d')

        # 检查网络错误
        if is_network_error "$response_body"; then
            if [[ $attempt -lt $MAX_RETRIES ]]; then
                sleep $RETRY_DELAY
                continue
            else
                echo "{\"status\": \"network_error\", \"message\": \"网络请求失败，请检查网络连接\", \"attempts\": ${attempt}}" | jq .
                exit 1
            fi
        fi

        # 检查 HTTP 状态码
        if [[ "$http_code" != "200" ]]; then
            if [[ $attempt -lt $MAX_RETRIES ]]; then
                sleep $RETRY_DELAY
                continue
            else
                echo "{\"status\": \"http_error\", \"message\": \"API 请求失败 (HTTP ${http_code})\", \"attempts\": ${attempt}, \"response\": ${response_body:0:500}}" | jq .
                exit 1
            fi
        fi

        echo "$response_body"
        return 0
    done
}

# ==================== 参数解析 ====================

KEYWORD=""
APP_NAME=""
SYSTEM_NAME=""
PIN=""
ERP=""
ENV=""
START_TIME=""
END_TIME=""
MAX_LINES=100

while [[ $# -gt 0 ]]; do
    case $1 in
        --keyword) KEYWORD="$2"; shift 2 ;;
        --appName) APP_NAME="$2"; shift 2 ;;
        --systemName) SYSTEM_NAME="$2"; shift 2 ;;
        --pin) PIN="$2"; shift 2 ;;
        --erp) ERP="$2"; shift 2 ;;
        --env) ENV="$2"; shift 2 ;;
        --startTime) START_TIME="$2"; shift 2 ;;
        --endTime) END_TIME="$2"; shift 2 ;;
        --maxLines) MAX_LINES="$2"; shift 2 ;;
        *) echo "未知参数: $1"; exit 1 ;;
    esac
done

# ==================== 参数校验 ====================

if [[ -z "${KEYWORD}" ]]; then
    echo '{"status": "error", "message": "缺少必要参数: --keyword"}' | jq .
    exit 1
fi

if [[ -z "${APP_NAME}" ]]; then
    echo '{"status": "error", "message": "缺少必要参数: --appName"}' | jq .
    exit 1
fi

if [[ -z "${SYSTEM_NAME}" ]]; then
    echo '{"status": "error", "message": "缺少必要参数: --systemName"}' | jq .
    exit 1
fi

if [[ -z "${ENV}" ]]; then
    echo '{"status": "error", "message": "缺少必要参数: --env"}' | jq .
    exit 1
fi

if [[ -z "${PIN}" ]]; then
    echo '{"status": "error", "message": "缺少必要参数: --pin (请提供京东 ERP 账号)"}' | jq .
    exit 1
fi

if [[ -z "${ERP}" ]]; then
    ERP="${PIN}"  # 默认使用 PIN 作为 ERP
fi

# ==================== 环境配置 ====================

get_api_base_url() {
    local env="$1"
    case "${env}" in
        "test"|"")
            echo "http://tianwei-gateway.jdtest.local"
            ;;
        "staging"|"prod")
            echo "https://dongmonitor.jd.com"
            ;;
        *)
            echo "http://tianwei-gateway.jdtest.local"
            ;;
    esac
}

# 根据环境自动添加后缀
get_app_name_with_env() {
    local app_name="$1"
    local env="$2"
    if [[ "${env}" == "test" ]]; then
        echo "${app_name}-test"
    else
        echo "${app_name}"
    fi
}

get_system_name_with_env() {
    local system_name="$1"
    local env="$2"
    if [[ "${env}" == "test" ]]; then
        echo "${system_name}-test"
    else
        echo "${system_name}"
    fi
}

need_proxy_header() {
    local env="$1"
    case "${env}" in
        "test"|"")
            echo "false"
            ;;
        "staging"|"prod")
            echo "true"
            ;;
        *)
            echo "false"
            ;;
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

# ==================== 时间处理 ====================

get_today_start_timestamp() {
    if [[ "$(uname)" == "Darwin" ]]; then
        local today=$(date +"%Y-%m-%d")
        local epoch=$(date -j -f "%Y-%m-%d %H:%M:%S" "${today} 00:00:00" +%s 2>/dev/null || echo "0")
        echo $(( epoch * 1000 ))
    else
        local epoch=$(date -d "$(date +"%Y-%m-%d") 00:00:00" +%s 2>/dev/null || echo "0")
        echo $(( epoch * 1000 ))
    fi
}

get_now_timestamp() {
    if [[ "$(uname)" == "Darwin" ]]; then
        echo $(( $(date +%s) * 1000 ))
    else
        echo $(( $(date +%s%N) / 1000000 ))
    fi
}

# 默认时间：当天
if [[ -z "${START_TIME}" ]]; then
    START_TIME=$(get_today_start_timestamp)
fi
if [[ -z "${END_TIME}" ]]; then
    END_TIME=$(get_now_timestamp)
fi

# ==================== 查询日志路径 ====================

API_BASE=$(get_api_base_url "${ENV}")
NEED_PROXY=$(need_proxy_header "${ENV}")

# 根据环境添加后缀
APP_NAME_WITH_ENV=$(get_app_name_with_env "${APP_NAME}" "${ENV}")
SYSTEM_NAME_WITH_ENV=$(get_system_name_with_env "${SYSTEM_NAME}" "${ENV}")

if [[ "${NEED_PROXY}" == "true" ]]; then
    PATH_URL="${API_BASE}/api/tianweiApi/tianmeng/v2/api/app_paths?source=jdos-release&appName=${APP_NAME_WITH_ENV}&systemName=${SYSTEM_NAME_WITH_ENV}&expandable=true&resourceSection=JDD"
else
    PATH_URL="${API_BASE}/tianmeng/v2/api/app_paths?source=jdos-release&appName=${APP_NAME_WITH_ENV}&systemName=${SYSTEM_NAME_WITH_ENV}&expandable=true&resourceSection=JDD"
fi

if [[ "${NEED_PROXY}" == "true" ]]; then
    PROXY_OPTS=$(get_proxy_opts "${ENV}")
    PATH_RESULT=$(curl_get_with_retry "${PATH_URL}" "-H \"accept: application/json\" -H \"token: token-origin\" -H \"x-proxy-opts: ${PROXY_OPTS}\"")
else
    PATH_RESULT=$(curl_get_with_retry "${PATH_URL}" "-H \"accept: application/json\" -H \"token: token-origin\"")
fi

NEW_PATHS=$(echo "${PATH_RESULT}" | jq -r '.data // []')
if [[ "$(echo "${NEW_PATHS}" | jq 'length')" -gt 0 ]]; then
    ALL_PATHS=$(echo "${NEW_PATHS}" | jq '[.[] | if type == "object" then .path else . end]')
    PRIORITY_PATHS=$(echo "${ALL_PATHS}" | jq '[.[] | select(test("error|default")) | select(test("biz-default") | not)]')
    if [[ "$(echo "${PRIORITY_PATHS}" | jq 'length')" -gt 0 ]]; then
        PATHS="${PRIORITY_PATHS}"
    else
        PATHS=$(echo "${ALL_PATHS}" | jq '[.[] | select(test("biz-default") | not)]')
    fi
else
    PATHS="[\"/export/Logs/${APP_NAME_WITH_ENV}/common-default.log\", \"/export/Logs/${APP_NAME_WITH_ENV}/common-error.log\"]"
fi

# ==================== 调用日志检索 API ====================

PAYLOAD=$(cat <<EOF
{
  "systemName": "${SYSTEM_NAME_WITH_ENV}",
  "appName": "${APP_NAME_WITH_ENV}",
  "keyword": "${KEYWORD}",
  "regex": false,
  "groups": [],
  "ips": [],
  "paths": ${PATHS},
  "startTimestamp": ${START_TIME},
  "endTimestamp": ${END_TIME},
  "timeout": 30000,
  "maxLines": ${MAX_LINES},
  "excludedWords": [],
  "erp": "${ERP}",
  "showPlain": false,
  "scroll": true,
  "stopOnFound": true
}
EOF
)

if [[ "${NEED_PROXY}" == "true" ]]; then
    GREP_URL="${API_BASE}/api/tianweiApi/tianmeng_search/v1/log/grep"
else
    GREP_URL="${API_BASE}/log-history/v1/log/grep"
fi

if [[ "${NEED_PROXY}" == "true" ]]; then
    PROXY_OPTS=$(get_proxy_opts "${ENV}")
    RESULT=$(curl_post_with_retry "${GREP_URL}" "${PAYLOAD}" "-H \"pin: ${PIN}\" -H \"token: token-origin\" -H \"x-proxy-opts: ${PROXY_OPTS}\"")
else
    RESULT=$(curl_post_with_retry "${GREP_URL}" "${PAYLOAD}" "-H \"pin: ${PIN}\" -H \"token: token-origin\"")
fi

# ==================== 返回结果 ====================

CODE=$(echo "${RESULT}" | jq -r '.code // 0')

if [[ "${CODE}" == "200" ]]; then
    # 提取完整的 results，包含 file 和 logs 信息
    RESULTS=$(echo "${RESULT}" | jq '.data.results // []')

    # 提取所有 logs 用于计数
    LOGS=$(echo "${RESULT}" | jq '[.data.results[].logs[]] | flatten')
    LOG_COUNT=$(echo "${LOGS}" | jq 'length')

    if [[ ${LOG_COUNT} -gt 0 ]]; then
        # 返回完整结果，包含 file 和 logs
        cat <<EOF
{"status": "success", "keyword": "${KEYWORD}", "results": ${RESULTS}, "logs": ${LOGS}, "count": ${LOG_COUNT}, "paths": ${PATHS}}
EOF
    else
        cat <<EOF
{
  "status": "not_found",
  "keyword": "${KEYWORD}",
  "message": "未找到匹配的日志",
  "suggestions": [
    "检查关键字是否完整正确",
    "扩大时间范围重新查询"
  ]
}
EOF
    fi
else
    MESSAGE=$(echo "${RESULT}" | jq -r '.msg // "未找到匹配的日志"')
    cat <<EOF
{
  "status": "not_found",
  "keyword": "${KEYWORD}",
  "message": "${MESSAGE}",
  "paths": ${PATHS},
  "system_name": "${SYSTEM_NAME}",
  "app_name": "${APP_NAME}",
  "env": "${ENV}",
  "start_time": ${START_TIME},
  "end_time": ${END_TIME},
  "suggestions": [
    "检查关键字是否完整正确",
    "扩大时间范围重新查询",
    "检查 appName 和 systemName 是否正确"
  ]
}
EOF
fi