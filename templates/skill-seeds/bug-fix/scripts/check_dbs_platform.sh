#!/bin/bash
# check_dbs_platform.sh - 京东 DBS 平台元数据查询（占位实现）
#
# 用法:
#   bash check_dbs_platform.sh <instanceName>
#
# 用途:
#   在极少数场景下，DUCC 里的连接串只写了逻辑名（如 jdbc:mysql://${dbs.mydb}/...）
#   或者需要确认数据库实例的：
#     - 主从拓扑（master/slave 节点数、region）
#     - 备份状态
#     - 授权白名单是否包含当前应用 IP
#     - MHA / 高可用状态
#   这类信息需要访问 DBS 平台（dbs.jd.com 或对应内部域名）。
#
# 现状:
#   - 尚未提供 DBS 平台 API 封装
#   - 官方 DBS 平台 API 需要走 ERP 白名单 / 特定 token，未公开
#   - 目前本脚本作为占位存在，返回 stub JSON 提示走人工链路
#
# 后续升级路径（TODO）:
#   1) 通过京ME → dbs.jd.com 抓包获取具体接口地址与鉴权头
#   2) 补齐 curl/urllib 调用逻辑
#   3) 输出统一 JSON:
#      {
#        "status":"success",
#        "instance":"...",
#        "nodes":[{"role":"master","ip":"...","region":"..."},{"role":"slave",...}],
#        "authorizedApps":[...],
#        "backupStatus":"OK|FAIL",
#      }
#
# 参数:
#   instanceName  DBS 实例名 / 逻辑库名
#
# 输出（stdout, JSON）:
#   { "status":"stub", "message":"DBS 平台查询尚未接入", "hint": "...", "manualUrl": "..." }
#
# 退出码:
#   2 = 占位/未实现（提醒调用方走 check_dbs_datasource.sh 或人工）

INSTANCE="${1:-}"

if [ -z "$INSTANCE" ]; then
    cat <<'JSON'
{
  "status": "error",
  "message": "用法: check_dbs_platform.sh <instanceName>"
}
JSON
    exit 2
fi

# 尝试探测是否有 SSO token（后续升级会用到）
TOKEN_FILE="$HOME/.jdtoken/jd-sso-token.json"
if [ ! -f "$TOKEN_FILE" ]; then
    TOKEN_FILE="$HOME/.joyclaw/workspace/jd-sso-token.json"
fi
HAS_TOKEN="false"
if [ -f "$TOKEN_FILE" ]; then
    HAS_TOKEN="true"
fi

# ---- 占位返回：明确告诉调用者该走哪条路径 ----
python3 - <<PYEOF
import json
result = {
    "status": "stub",
    "instance": "$INSTANCE",
    "hasSSOToken": $HAS_TOKEN,
    "message": "DBS 平台元数据查询未实现。Bug 分析场景请按下列优先级排查:",
    "recommendations": [
        {
            "step": 1,
            "action": "先用 check_dbs_datasource.sh 从 DUCC 反查连接串",
            "cmd": "bash check_dbs_datasource.sh <appCode> [profileHint]",
            "coverage": "覆盖 90% 场景（url/username/host 都在 DUCC 里）"
        },
        {
            "step": 2,
            "action": "如果连接串只有逻辑名，需要人工到 DBS 控制台查实例信息",
            "url": "http://dbs.jd.com",
            "focus": [
             "主从节点 IP 与 region",
                "白名单是否包含应用 IP",
                "SSL/证书状态",
                "备份 / MHA 是否正常"
            ]
        },
        {
            "step": 3,
            "action": "若 Bug 与慢 SQL / 死锁 / 主从延迟相关，需查 DBS 慢日志或 DAS",
            "url": "http://das.jd.com",
            "focus": [
                "慢 SQL Top 列表",
                "主从延迟 (Seconds_Behind_Master)",
                "锁等待与死锁历史"
            ]
        }
    ],
    "todo": "如需自动化，请提供 DBS 平台 API 抓包结果并补齐本脚本"
}
print(json.dumps(result, ensure_ascii=False))
PYEOF

exit 2