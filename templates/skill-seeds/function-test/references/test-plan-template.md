# 测试方案 md 模板（handoff 风格）

> 本模板参考 `yzt-stock-erp/.harness/changes/20260729-002-储位库存二期/验证执行-handoff-20260817.md` 的组织方式，产出「可交接、可复现」的验证记录文档。**同一个变更只维护一份 md**，多轮验证追加到「执行记录」章节，不覆盖历史。

---

# <变更主题> 验证执行 handoff（<日期>）

- **变更 ID**：<yyyyMMdd-序号-简述>
- **项目**：<repo-name>
- **分支**：<branch>（HEAD sha: <short-sha>）
- **负责人**：<name> <email>
- **验收人**：<name>
- **验证环境**：test / staging / prod
- **JSF 直连 host**：<ip:port>（仅 `entry_kind=jsf_only` 时必填）
- **HTTP base URL**：<eone/test 网关>（有 OpenApi/Controller 时优先）
- **entry_kind**：`http_openapi` / `http_controller` / `http_and_jsf` / `jsf_only`

## 0. 断点续跑状态（唯一 SSOT）

> **禁止手工编辑本节 YAML**。所有更新走 `scripts/update_state.sh` 原子写入。
> 新 Agent 加载后，第一步先读 `next_action` 判断下一步。
> 详见 [resume-protocol.md](resume-protocol.md)。

<!-- STATE:BEGIN -->
```yaml
schema_version: 1
change_id: "<yyyyMMdd-序号-简述>"
repo: "<repo-name>"
branch: "<branch>"
head_sha: "<short-sha>"
created_at: "<iso8601>"
updated_at: "<iso8601>"
current_stage: stage1_collect   # stage1_collect|stage2_scope|stage3_impact|stage4_plan|stage5_execute|stage6_report|done
blocked_on: change_confirmed    # 当前卡在哪个 gate；null 表示不阻塞
gates:
  change_confirmed:  { status: pending, at: null, note: null }  # 改动清单被用户确认
  scope_confirmed:   { status: pending, at: null, note: null }  # 测试范围（§2）被用户确认
  impact_confirmed:  { status: pending, at: null, note: null }  # 链路影响（§3）被用户确认
  plan_confirmed:    { status: pending, at: null, note: null }  # 执行方案（§4-6）被用户确认
  execute_done:      { status: pending, at: null, note: null }  # 所有用例执行完成
  report_done:       { status: pending, at: null, note: null }  # 结论/失败根因写入
runs: []             # 每次 run 追加 { run_id, at, host, cases_total, cases_pass, cases_fail }
pending_cases: []    # 未跑完的用例 [{ id, name, run_id, status }]
next_action:
  kind: ask_user     # ask_user|run_case|write_report|handoff_bugfix|done
  prompt: "请确认 §1 改动清单是否完整？确认后进入 §2 范围拆解。"
  stage: stage1_collect
  gate: change_confirmed
```
<!-- STATE:END -->

## 1. 改动清单

- 分支：<branch>
- Base：<base>
- 本人 commit：N；他人 commit：M（<说明>）

### 1.1 Commits
| SHA | 时间 | 主题 |
|-----|------|------|
| ... | ... | ... |

### 1.2 文件变更（按模块）
#### API 契约
- M ...

#### 业务服务
- A ...

#### 数据访问
- M ...

## 2. 测试范围

| # | 测试点 | 触发路径 | 必测 | 备注 |
|---|--------|----------|-----|------|
| 1 | ... | ... | ✅ | ... |
| 2 | ... | ... | ✅ | ... |
| 3 | ... | ... | ❌ | 冒烟 |

## 3. 链路影响

### 3.1 <测试点 1>
- 入口：`<class#method>`
- 调用链：
  - A → B → C
- DB 表：
  - `<table>`（分片：`<rule>`）
- 缓存：`<key-pattern>`
- MQ：`<topic>`（生产/消费）
- 风险点：
  - <类别>: <描述>

### 3.2 <测试点 2>
（同上）

## 4. 测试数据

### 4.1 数据集
| 用例 | erpOrgCode | erpStationNo | erpGoodsId | 说明 |
|------|-----------|--------------|------------|------|
| COMMON | 800062 | 260729002 | 4402 | 常规链路 |
| LOSS   | 800065 | 900001    | 4630 | 报损链路 |

### 4.2 执行前快照

> 使用 db-query 采样；SQL 白名单只允许 `SELECT/SHOW/DESC`，字段名含 `create` 关键字会被误拦，用 `gmt_create` / 精选列表规避。

```bash
bash "${JOYCODE_SKILLS_DIR:-$HOME/.joycode/skills}/db-query/scripts/query.sh" \
  yzt-stock-erp-test yzt_stock_erp_test_slave test \
  "SELECT id, stock_num, lock_num FROM stock_erp_62 WHERE erp_org_code = 800062 AND erp_goods_id = 4402"
```

| 表 | 记录 | before |
|----|------|--------|
| stock_erp_62 | (800062,4402) | stock=1000, lock=0 |
| storage_stock_erp_2 | (800062,4402,st1) | stock=200, lock=0 |
| batch_stock_erp_62 | (800062,4402,B1) | stock=500 |

## 5. 执行方案

### 5.1 环境准备

- **JDK8** 路径：`/Library/Java/JavaVirtualMachines/jdk-1.8.jdk/Contents/Home`（若项目 pom 依赖 JDK17，Javassist 反射会失败，务必用 JDK8）
- **Maven settings**：`-s ${MAVEN_SETTINGS:-~/.m2/settings.xml}`
- **API classpath**：
  ```bash
  mvn -pl <api-module> dependency:build-classpath \
    -Dmdep.outputFile=/tmp/api-cp.txt -DincludeScope=test \
    -s ${MAVEN_SETTINGS:-~/.m2/settings.xml}
  ```
- **独立 runner**：`/tmp/RunXxxValidation.java`，绕开 test-compile 依赖问题

### 5.2 HTTP / OpenApi 调用（`entry_kind` 含 http 时优先）

- base URL：`<http_base_url>`
- path：`<从 @OpenApi 解析，如 /base-pay/emp-refund-record/page>`
- method：POST（默认）
- 详见 [`http-openapi-invoke.md`](http-openapi-invoke.md)

### 5.3 JSF 直连调用（`jsf_only` 或 HTTP 失败降级时）

- host：`<ip:port>`
- 关键 JVM：`-Ddirect=true -Ddirect.host=<ip:port> -DrunId=<MMddHHmm>`
- runId：每一轮唯一，避免 businessNo 幂等重复；命名规则 `MMddHHmm[+suffix]`
- 详见 [`jsf-direct-invoke.md`](jsf-direct-invoke.md)

### 5.4 无测试数据降级

若暂时缺 pin/erpOrgCode：**同一闸门须含 hb-choices「先部分验证」**；静态 + Pod 端口/TCP 探测 + §9 标 `verification_level: partial` 后立即 `done`。见 SKILL.md Stage 5.1 / 5.2。

## 6. 用例矩阵

| # | 用例 | 前置数据 | 步骤 | 预期 | 数据核对点 |
|---|------|----------|------|------|------------|
| 1 | 报损创建 | COMMON | opType=33，num=5 | code=0，stock_lock+5，storage_stock_lock 新增 1 条含 id | stock_erp_62.lock_num、storage_stock_lock新增记录 |
| 2 | 报损取消 | 承接 #1 | opType=34 | code=0，stock_lock-5，明细置失效 | 同上，行数减少 / 状态位翻转 |
| 3 | 报损出库 | 承接 #1 | opType=35 | code=0，stock-5、stock_lock-5、storage 归 0、生成流水 | stock_flow_erp_XX 新增出库流水 |

## 7. 执行记录

### 7.1 Run <runId-1> — <yyyy-MM-dd HH:mm>

| # | 用例 | 响应 code | 响应 msg | 耗时 | traceId |
|---|------|-----------|---------|------|---------|
| 1 | 报损创建 | 0 | success | 213ms | <trace> |
| 2 | 报损取消 | 0 | success | 187ms | <trace> |
| 3 | 报损出库 | 291072 | 储位库存更新失败 | 356ms | <trace> |

#### 事后快照对账
| 表 | before | after | diff | 预期 diff | 判定 |
|----|--------|-------|------|-----------|------|
| stock_erp_62.lock_num | 0 | 5 | +5 | +5 | ✅ |
| stock_erp_62.stock_num | 1000 | 1000 | 0 | -5 | ❌ 报损出库未生效 |

### 7.2 Run <runId-2>（补充定位）

> 追加补充执行；不覆盖前次记录。

## 8. 失败根因

### 8.1 <失败用例> —— <一句话结论>

- **现象**：JSF 响应 code=291072，DB 事务回滚
- **traceId**：<...>
- **关键日志**（log-search 拉取）：
  ```
  <error stack summary>
  ```
- **根因链**：
  1. StorageStockLock 缓存对象在 harvest 阶段未回填 `id`
  2. `updateByPrimaryKeySelective` 命中 `id=null` → SQL 行 0
  3. 上游拿到 rows=0 抛 `291072 储位库存更新失败`
  4. 事务回滚，主库存/储位/流水均回退
- **修复方向**（供 bug-fix 参考）：
  - `insert` 端使用 `useGeneratedKeys` 回填 id
  - `update` 端在 id=null 时降级按业务唯一键
  - 明细类 CRUD 增加 rows==0 的告警/异常

---

## 9. 结论

- 通过用例：<N> / <total>
- 失败用例：<M>（详见 § 8）
- **处置**：
  - [ ] 开启修复 → bug-fix skill
  - [ ] 用户自行解决

## 附录 A：常用 SQL 片段

```sql
-- 主库存
SELECT id, stock_num, lock_num, gmt_create FROM stock_erp_${orgCode%64}
 WHERE erp_org_code = ? AND erp_goods_id = ?;

-- 储位库存
SELECT id, stock_num, lock_num, storage_no FROM storage_stock_erp_${stationNo%100}
 WHERE erp_org_code = ? AND erp_station_no = ? AND erp_goods_id = ?;

-- 批次
SELECT id, stock_num, batch_no FROM batch_stock_erp_${orgCode%64}
 WHERE erp_org_code = ? AND erp_goods_id = ? AND batch_no = ?;

-- 主库存锁定明细
SELECT id, delta, business_no, gmt_create FROM stock_transit_lock
 WHERE erp_org_code = ? AND erp_goods_id = ? ORDER BY id DESC LIMIT 10;

-- 储位锁定明细
SELECT id, delta, business_no, gmt_create FROM storage_stock_lock
 WHERE erp_org_code = ? AND erp_station_no = ? AND erp_goods_id = ?
 ORDER BY id DESC LIMIT 10;

-- 流水
SELECT id, biz_type, delta, business_no, gmt_create FROM stock_flow_erp_${goodsId%100}
 WHERE erp_org_code = ? AND erp_goods_id = ? ORDER BY id DESC LIMIT 10;
```

## 附录 B：JSF 泛化参数骨架

```json
{
  "erpOrgCode": 800062,
  "erpStationNo": "260729002",
  "erpGoodsId": 4402,
  "opType": 33,
  "num": 5,
  "businessNo": "RUN-<runId>-CASE-01",
  "operator": "<pin>",
  "extra": {}
}
```