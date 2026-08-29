# HTTP / OpenApi 调用指引

> 当改动入口存在 `@OpenApi`、`@RestController`、`@RequestMapping` 时，**优先走 HTTP**，不必强行 JSF 泛化调用。

## 一、何时选 HTTP

| 信号 | 说明 |
|------|------|
| 源码有 `@OpenApi(outerUrl=...)` | 海博 OpenApi 网关暴露的 HTTP 路径 |
| 源码有 `@RestController` / `@RequestMapping` | 标准 Spring HTTP 入口 |
| JSF 泛化依赖拉不下来 / JDK8 环境不齐 | HTTP + curl 通常更轻 |
| 缺陷 trace 来自 HTTP 访问日志 | 与线上真实路径一致 |

仍走 JSF 的场景：仅 JSF Provider、无 HTTP 映射、或必须验证 JSF 序列化/alias 行为。

## 二、从代码解析路径（Stage 3 必做）

在改动 impl 文件中搜索：

```bash
rg -n '@OpenApi|@RequestMapping|@PostMapping|@GetMapping' <changed-files>
```

记录到 test-plan §3 / §5：

- `http_method`：POST / GET（OpenApi 多为 POST）
- `http_path`：如 `/base-pay/emp-refund-record/page`
- `entry_kind`：`http_openapi` / `http_controller` / `jsf_only`

## 三、base URL 解析顺序（Stage 5）

**eone Pod 上 HTTP 常不可用** — 须先 [`SKILL.md` Stage 5.0.1](../SKILL.md) 用 `lsof -P -n` 验证，**不可**仅凭 `application.yml` 拼 URL。

按序尝试：

1. 部署交接块 `test_entry.http_base_url`（仅当 `http_port_pod_status=verified` 或 Pod 探测确认监听）
2. **Pod 直连**：`http://<podIP>:<port>` — port 必须来自 **lsof 实测**，不是配置文件默认值
   - 配置文件 `server.port`（如 28080）在 eone **可能未 LISTEN**
   - env `proxyHttpPort`（如 50015）**通常不是**应用 HTTP，勿直接使用
3. 缺陷描述 / 工单里的环境 URL、域名
4. 项目文档：`.harness/wiki/`、`README`
5. **HTTP 均不可达** → 降级 JSF（见 [`jsf-direct-invoke.md`](jsf-direct-invoke.md)），`entry_kind` 改为 `jsf_primary`

拼接完整 URL：`{http_base_url}{http_path}`（base 末尾不要重复 `/`）。

## 四、curl 调用模板

### 4.1 Pod 直连 HTTP（须先验证端口监听）

```bash
# Pod 内：确认 HTTP 端口（示例 PID=520）
lsof -p 520 -i -P -n | grep LISTEN
# 仅当列表含 application.yml 的 server.port 时才 curl 外网/Pod IP

POD_IP="6.244.250.86"
HTTP_PORT="<lsof 实测端口，非假设值>"
PATH="/base-pay/emp-refund-record/page"
curl -sS -X POST "http://${POD_IP}:${HTTP_PORT}${PATH}" \
  -H "Content-Type: application/json" \
  -d @/tmp/case-01.json | jq .
```

### 4.2 OpenApi 经网关（可选）

```bash
BASE="https://<eone-or-test-gateway>"
PATH="/base-pay/emp-refund-record/page"
curl -sS -X POST "${BASE}${PATH}" \
  -H "Content-Type: application/json" \
  -d @/tmp/case-01.json | jq .
```

请求体字段对齐 client DTO（如 `SparkEmpRefundRecordRequest` + `AppContext` 的外层包装，以项目 OpenApi 规范为准）。

### 4.3 普通 Controller

```bash
curl -sS -X POST "http://<host>:<port>/api/..." \
  -H "Content-Type: application/json" \
  -d '{...}'
```

## 五、判定与证据

- 记录：HTTP 状态码、响应 body 的 `code`/`msg`、耗时
- 除零 / NPE 类缺陷：修复前常见 500 + `ArithmeticException`；修复后应为业务正常响应或业务错误码，**不应再出现除零堆栈**
- 失败时用 **log-search** 按 traceId / 时间窗拉日志

## 六、与 JSF 的关系

- 同一方法可能 JSF + OpenApi 双入口；**验证修复生效任一条链路即可**，不必两条都跑
- §7 执行记录须注明 `entry: http` 或 `entry: jsf`

## 七、无测试数据时的 HTTP 降级

若暂时拿不到 pin / erpOrgCode 等：

1. **静态**：确认缺陷代码行已删除（`git show` / 读源码）
2. **编译/单测**：项目有模块测试则跑相关 test
3. **最小请求**：用空/默认 body 调用，预期「参数校验失败」而非 500 除零 — 证明不再 crash
4. **日志回放**：缺陷 traceId + 部署后时间窗 log-search
5. 在 §9 结论标注 **「部分验证」**，列出未完成项，**不要无限阻塞**在索要测试用户
