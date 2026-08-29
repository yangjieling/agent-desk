# JSF IP 直连调用指引

> **入口选择**：若同一方法存在 `@OpenApi` / HTTP 映射，function-test **优先 HTTP**（见 [`http-openapi-invoke.md`](http-openapi-invoke.md)）。本文档仅适用于 `entry_kind=jsf_only` 或 HTTP 不可用时的降级。

> function-test 中 JSF 调用**必须走 IP 直连**（点对点）。IP 由用户提供或部署交接块提供；不走注册中心/泳道，避免拉到错误环境或触发别人的灰度。

## 一、为什么必须直连

| 场景 | 走注册中心的问题 | IP 直连的收益 |
|------|-------------------|---------------|
| 联调 | 可能命中队友的机器，问题看不到自己代码里 | 命中确定 IP，日志/DB 与代码一一对应 |
| 泳道混杂 | 泳道路由规则复杂，稍有配置不对就跨环境 | 显式绕过泳道 |
| 灰度验证 | 灰度分流可能把请求打到旧版本 | 直接命中新版本机器 |
| 复现 bug | 每次调用可能落到不同实例，日志难串 | 固定实例，traceId 与日志强相关 |

## 二、必备信息（向用户索要或从交接块/探测获取）

调用前必须确认：

1. **host**：`ip:port`，例 `6.244.250.86:22001`
   - **端口来源**：Pod 内 `jsf.properties` → `dong.jsf.servers.server1.port`（常见 22001）
   - 用 `lsof -p <pid> -i -P -n | grep LISTEN` 验证；平台可能另有附加端口（如 50020），**优先配置文件端口**
   - Pod 内快速探测：`echo > /dev/tcp/127.0.0.1/22001 && echo OK`
2. **接口**：完整全限定名，例 `com.yzt.stock.erp.api.StorageStockChangeGeneric`
3. **方法名 + 参数类型**：例 `invoke(java.lang.String, java.util.Map)`
4. **超时**：默认 30000ms，长事务可加大到 60000ms
5. **runId 前缀**：默认 `date +%m%d%H%M`；用户可覆盖
6. **别名 alias**（可选）：多分组时用；默认与 provider 侧一致

## 三、调用方式

### 3.1 使用本 skill 封装脚本

```bash
FT="${FT_DIR:-${JOYCODE_SKILLS_DIR:-$HOME/.joycode/skills}/function-test}"
bash "$FT/scripts/jsf_invoke.sh" \
  --host 6.244.233.39:22012 \
  --interface com.yzt.stock.erp.api.StorageStockChangeGeneric \
  --method invoke \
  --param-file /tmp/case-01.json \
  --run-id $(date +%m%d%H%M) \
  --timeout 30000
```

脚本会：

1. 生成一个临时 runner Java 类（JSF 泛化）
2. 通过 `-Ddirect=true -Ddirect.host=<host>` 强制直连
3. 输出 `code / msg / traceId / 耗时`
4. 保存原始响应到 `/tmp/jsf-<runId>.json`

### 3.2 项目内使用 Maven runner（handoff 风格）

```bash
# 1) 生成 API classpath
cd <repo>
mvn -pl <api-module> dependency:build-classpath \
  -Dmdep.outputFile=/tmp/api-cp.txt -DincludeScope=test \
  -s "${MAVEN_SETTINGS:-$HOME/.m2/settings.xml}" -q

# 2) 编译 runner
JDK8=/Library/Java/JavaVirtualMachines/jdk-1.8.jdk/Contents/Home
$JDK8/bin/javac -cp "$(cat /tmp/api-cp.txt)" /tmp/RunXxxValidation.java -d /tmp

# 3) 执行（直连）
$JDK8/bin/java -cp "/tmp:$(cat /tmp/api-cp.txt)" \
  -Ddirect=true -Ddirect.host=6.244.233.39:22012 \
  -DrunId=$(date +%m%d%H%M) \
  RunXxxValidation
```

### 3.3 直接使用 JSF Generic API（示例代码）

```java
ConsumerConfig<GenericService> cc = new ConsumerConfig<>();
cc.setInterfaceId("com.yzt.stock.erp.api.StorageStockChangeGeneric");
cc.setGeneric(true);
cc.setProtocol("jsf");
cc.setUrl("jsf://6.244.233.39:22012"); // <— 关键：直连
cc.setTimeout(30000);

GenericService svc = cc.refer();
Object resp = svc.$invoke(
    "invoke",
    new String[]{"java.lang.String", "java.util.Map"},
    new Object[]{"BS_OUT", paramMap}
);
```

关键点：**`cc.setUrl("jsf://ip:port")`** 才是真正让 JSF SDK 绕过注册中心的开关；只加 `-Ddirect=true` 不够（不同 SDK 版本对系统属性识别不同）。

## 四、环境要求

- **JDK8** 优先：某些老版本 JSF SDK（含 Javassist 反射）在 JDK17 上会抛 `InaccessibleObjectException`；直接用 JDK8 最稳。
- **Maven settings**：通过环境变量 `MAVEN_SETTINGS` 指定（默认 `~/.m2/settings.xml`）；JD 内网私服需自行配置。
- **网络**：直连 IP 需要能通到 Provider 机器；本地开发机通常需要走 JD 内网 VPN 或跳板机。若不通，请用户切网络。

## 五、runId 与幂等

- **规则**：每一轮验证生成一个 `runId`，格式 `MMddHHmm` 或 `MMddHHmm-suffix`
- **用途**：拼进 `businessNo`（如 `BS-OUT-08181530-C01`），保证：
  - 相同用例第二次跑不会被幂等拦截
  - 日志可按 runId 反查
  - DB 明细行有明显区分度
- **落盘**：每次 run 结果附 runId 写入 handoff md 的 § 7，永不覆盖历史 run。

## 六、常见错误

| 错误 | 处理 |
|------|------|
| `No provider available` | 未生效直连；确认 `cc.setUrl("jsf://ip:port")` |
| `Read timed out` | 超时太短或对端处理慢；加 timeout / 检查 provider 日志 |
| `Class not found: com.jd.jsf....` | classpath 缺 API 依赖；重跑 `build-classpath` |
| `Unable to make ... accessible: module ...` | 用了 JDK17；切 JDK8 |
| 响应成功但 DB 无变化 | 检查是否命中的是 mock / 是否有事务回滚（拉 traceId） |
| 响应报 `xxx handler code=291072` | 参考 handoff §8 类型的根因（明细缓存缺 id 等）；转 log-search 拉堆栈 |

## 七、参数模板

### 7.1 通用 map 型（stock-erp 为例）

```json
{
  "erpOrgCode": 800062,
  "erpStationNo": "260729002",
  "erpGoodsId": 4402,
  "opType": 33,
  "num": 5,
  "businessNo": "BS-OUT-<runId>-C01",
  "operator": "<pin>",
  "extra": {
    "storageNo": "st1",
    "batchNo": "B1"
  }
}
```

### 7.2 POJO 型（DTO 通过 map 表示，全部下划线转驼峰对齐 API 字段）

- JSF 泛化调用会把 `Map<String,Object>` 自动映射成目标 POJO
- 字段名大小写敏感，务必和 API 字段一一对应
- 嵌套对象一层层写成 map，日期用 `long` 时间戳

## 八、与 log-search / db-query 的联动

- 调用完成后立即记录 `traceId`（响应头 or 响应体）
- 失败时立即用 `log-search` 拉近端日志（`--keyword <traceId>`）
- 数据核对用 `db-query`，前后各一次快照，diff 存 handoff § 7
- 中间过程 db-query 免二次确认（skill 已在 SKILL.md § 4.3 声明）