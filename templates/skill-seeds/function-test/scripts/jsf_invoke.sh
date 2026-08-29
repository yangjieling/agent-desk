#!/usr/bin/env bash
# jsf_invoke.sh - JSF 泛化调用 IP 直连封装
#
# 用法：
#   bash jsf_invoke.sh \
#     --host 10.0.0.1:22000 \
#     --interface com.jd.stock.api.StockService \
#     --method  updateStock \
#     --param-file params.json \
#     [--param-types "com.jd.stock.dto.StockReq"] \
#     [--alias default] \
#     [--run-id 08181530-001] \
#     [--timeout 5000] \
#     [--work-dir /tmp/jsf-runner] \
#     [--repo /path/to/business/repo]
#
# 依赖：JDK8 + Maven；business repo 需要能通过 mvn dependency:build-classpath 拉到 JSF 依赖
# 输出：stdout 打印摘要，原始响应落到 <work-dir>/response-<runId>.json
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

HOST=""
IFACE=""
METHOD=""
PARAM_FILE=""
PARAM_TYPES=""
ALIAS="default"
RUN_ID=""
TIMEOUT="5000"
WORK_DIR=""
REPO=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)         HOST="$2"; shift 2 ;;
    --interface)    IFACE="$2"; shift 2 ;;
    --method)       METHOD="$2"; shift 2 ;;
    --param-file)   PARAM_FILE="$2"; shift 2 ;;
    --param-types)  PARAM_TYPES="$2"; shift 2 ;;
    --alias)        ALIAS="$2"; shift 2 ;;
    --run-id)       RUN_ID="$2"; shift 2 ;;
    --timeout)      TIMEOUT="$2"; shift 2 ;;
    --work-dir)     WORK_DIR="$2"; shift 2 ;;
    --repo)         REPO="$2"; shift 2 ;;
    -h|--help)
      grep -E '^# ' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

for v in HOST IFACE METHOD PARAM_FILE; do
  if [[ -z "${!v}" ]]; then
    echo "缺少必备参数 --${v,,}" >&2
    exit 2
  fi
done

if [[ ! -f "$PARAM_FILE" ]]; then
  echo "param 文件不存在: $PARAM_FILE" >&2
  exit 2
fi

[[ -z "$RUN_ID"   ]] && RUN_ID="$(date +%m%d%H%M)-manual"
[[ -z "$WORK_DIR" ]] && WORK_DIR="/tmp/jsf-runner-$$"
mkdir -p "$WORK_DIR"

# --- JDK 版本自检 ---
if command -v java >/dev/null 2>&1; then
  JAVA_MAJOR=$(java -version 2>&1 | head -1 | sed -E 's/.*version "([0-9]+).*/\1/')
  if [[ "$JAVA_MAJOR" -ne 8 && "$JAVA_MAJOR" != "1" ]]; then
    echo "⚠️  当前 Java 主版本 $JAVA_MAJOR，JSF 泛化依赖反射，强烈建议切换 JDK8 后再执行" >&2
  fi
else
  echo "未找到 java 命令" >&2
  exit 3
fi

# --- 构建 classpath ---
if [[ -z "$REPO" ]]; then
  echo "未提供 --repo，无法解析 JSF 依赖 classpath；请指定业务仓库根目录" >&2
  exit 3
fi

if [[ ! -f "$REPO/pom.xml" ]]; then
  echo "$REPO 下未找到 pom.xml" >&2
  exit 3
fi

CP_FILE="$WORK_DIR/cp.txt"
MAVEN_SETTINGS="${MAVEN_SETTINGS:-${HOME}/.m2/settings.xml}"
MVN_OFFLINE_FLAG=""
if [[ "${MAVEN_OFFLINE:-}" == "1" || "${MAVEN_OFFLINE:-}" == "true" ]]; then
  MVN_OFFLINE_FLAG="-o"
fi
MVN_SETTINGS_FLAG=()
if [[ -f "$MAVEN_SETTINGS" ]]; then
  MVN_SETTINGS_FLAG=(-s "$MAVEN_SETTINGS")
fi

echo "→ 生成 classpath (mvn dependency:build-classpath)…" >&2
(cd "$REPO" && mvn "${MVN_OFFLINE_FLAG}" -q dependency:build-classpath \
  -Dmdep.outputFile="$CP_FILE" -DincludeScope=runtime "${MVN_SETTINGS_FLAG[@]}")
CP=$(cat "$CP_FILE")

# 也把项目自身的 target/classes 挂上，便于加载参数 DTO
for cls in $(find "$REPO" -type d -name classes -path "*/target/*" 2>/dev/null); do
  CP="$cls:$CP"
done

# --- 生成 Runner.java ---
RUNNER="$WORK_DIR/JsfRunner.java"
RESP="$WORK_DIR/response-$RUN_ID.json"

# 读取参数原文（作为 JSON 字符串塞进 Runner）
PARAM_JSON_ESCAPED=$(python3 -c 'import json,sys; print(json.dumps(open(sys.argv[1]).read()))' "$PARAM_FILE")
PARAM_TYPES_JAVA=""
if [[ -n "$PARAM_TYPES" ]]; then
  # "a.b.C,x.y.Z" -> "\"a.b.C\",\"x.y.Z\""
  PARAM_TYPES_JAVA=$(echo "$PARAM_TYPES" | awk -F',' '{
    for(i=1;i<=NF;i++){ gsub(/^ +| +$/,"",$i); printf("\"%s\"%s", $i, (i<NF?",":"")); }
  }')
fi

cat > "$RUNNER" <<JAVA
import com.jd.jsf.gd.config.ConsumerConfig;
import com.jd.jsf.gd.service.GenericService;
import com.alibaba.fastjson.JSON;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class JsfRunner {
    public static void main(String[] args) throws Exception {
        ConsumerConfig<GenericService> cc = new ConsumerConfig<>();
        cc.setInterfaceId("$IFACE");
        cc.setAlias("$ALIAS");
        cc.setGeneric(true);
        cc.setProtocol("jsf");
        cc.setTimeout($TIMEOUT);
        cc.setUrl("jsf://$HOST");
        cc.setCheck(false);

        GenericService svc = cc.refer();

        String paramJson = $PARAM_JSON_ESCAPED;
        String[] types;
        Object[] params;
        String[] declaredTypes = new String[]{ ${PARAM_TYPES_JAVA:-} };

        if (declaredTypes.length == 0) {
            // 默认按 Map 泛化
            types  = new String[]{ "java.util.Map" };
            @SuppressWarnings("unchecked")
            Map<String,Object> m = JSON.parseObject(paramJson, Map.class);
            params = new Object[]{ m };
        } else if (declaredTypes.length == 1) {
            types  = declaredTypes;
            params = new Object[]{ JSON.parseObject(paramJson, Object.class) };
        } else {
            // 多参：paramJson 期望是数组
            types  = declaredTypes;
            @SuppressWarnings("unchecked")
            List<Object> list = JSON.parseObject(paramJson, List.class);
            params = list.toArray();
        }

        long start = System.currentTimeMillis();
        Object resp;
        try {
            resp = svc.\$invoke("$METHOD", types, params);
        } catch (Throwable t) {
            Map<String,Object> err = new HashMap<>();
            err.put("code", -1);
            err.put("msg", t.getClass().getName() + ": " + t.getMessage());
            err.put("elapsedMs", System.currentTimeMillis() - start);
            System.out.println(JSON.toJSONString(err));
            System.exit(1);
        }
        long cost = System.currentTimeMillis() - start;

        Map<String,Object> out = new HashMap<>();
        out.put("elapsedMs", cost);
        out.put("runId", "$RUN_ID");
        out.put("response", resp);
        System.out.println(JSON.toJSONString(out));
    }
}
JAVA

echo "→ 编译 Runner…" >&2
javac -cp "$CP" -d "$WORK_DIR" "$RUNNER"

echo "→ 调用 $IFACE#$METHOD @ $HOST (runId=$RUN_ID)…" >&2
JVM_OPTS="-Djsf.log.disable=false -Djsf.registry.check=false"

set +e
java $JVM_OPTS -cp "$WORK_DIR:$CP" JsfRunner > "$RESP"
RC=$?
set -e

if [[ $RC -ne 0 ]]; then
  echo "❌ 调用失败 (exit=$RC)" >&2
  cat "$RESP" >&2 || true
  exit $RC
fi

# --- 摘要 ---
if command -v python3 >/dev/null 2>&1; then
  python3 - <<PY
import json,sys
try:
    d=json.load(open("$RESP"))
except Exception as e:
    print("原始响应无法解析: ", e); sys.exit(0)

resp=d.get("response") or {}
code=resp.get("code") if isinstance(resp,dict) else None
msg =resp.get("msg")  if isinstance(resp,dict) else None
print(f"✅ runId={d.get('runId')} elapsedMs={d.get('elapsedMs')}")
print(f"   code={code} msg={msg}")
print(f"   响应原文：$RESP")
PY
else
  echo "✅ 调用完成，响应写入 $RESP"
fi