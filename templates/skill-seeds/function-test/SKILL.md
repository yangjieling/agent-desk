---
version: 1.0.0
name: function-test
description: 功能测试执行 Skill。以「改动梳理 → 范围确认 → 链路影响 → 测试方案 → 执行验证 → 不通过汇报」为主线，串联 db-query / log-search / bug-fix / jd-token-tool 等横向能力，产出可复现、可交接的验证报告。执行入口按改动类型选择：有 OpenApi/Controller 时优先 HTTP；仅 JSF Provider 时走 IP 直连。中间过程查库不需要用户确认。当用户说「测试这个改动 / 帮我测下这个功能 / 出个测试方案 / 验证一下这个分支 / 执行验证」等场景时激活。
---


# function-test — 功能测试执行技能

一个**面向单分支改动**的功能验证工具集：从改动收集，到测试方案设计，到 **HTTP/OpenApi 或 JSF 直连**执行、DB 核对、日志检索、失败根因定位，一条线到底。**目标是把开发者自测做成可交接、可复现的工程动作**，而不是"跑一下看看"。

## 〇、断点续跑协议（新会话必读）

本 skill 遵循「**单文档 SSOT + 状态即文档**」的续跑协议。整个测试生命周期只维护 **一份 `test-plan.md`**，其 § 0 状态块（`STATE:BEGIN` / `STATE:END` 之间的 YAML）就是唯一状态源，随时中断、跨模型、换 Agent 都能续跑。

### 0.1 Agent 加载后第一步（强制）

**每次加载 skill 后第一句必须问用户**：

> 请问是**新任务**，还是**继续之前的 test-plan.md**？
> - 新任务 → 从 Stage 1 开始
> - 继续 → 请提供 test-plan.md 路径，我会读取 § 0 状态块并从 `next_action` 恢复

**唯一例外：部署后 shared workflow 交接模式**

若当前 prompt / 上下文里已经明确包含 `## 部署交接上下文` 或 `handoff_to: function-test` 这一类上游交接块，则视为“来自部署步骤的新任务”，**不要再追问新任务/继续**，直接按“新任务”处理并复用交接信息：

- 从交接块读取 `app / env / branch / groups / artifact`
- 若带了 `test_entry.jsf_host` / `test_entry.http_base_url` / `test_entry.http_path`，写入 § 5 执行方案
- 若 `test_entry.kind = pending_user_input`，则在 Stage 4/5 按**入口类型**补问（有 OpenApi 优先 HTTP，仅 JSF 才问 host）
- 在 § 1 改动清单和 § 4/§ 5 中注明“本次验证基于已完成的部署产物”

若用户提供路径，用 `read_file` 读该 md 的 § 0，按 `next_action.kind` 决策：

| kind | Agent 动作 |
|------|------------|
| `ask_user` | 输出 `prompt`，等待用户回复 |
| `run_case` | 从 `pending_cases[0]` 取用例，进入 Stage 5 执行 |
| `write_report` | 进入 Stage 6，生成结论 |
| `handoff_bugfix` | 切换 bug-fix skill，将 § 8 根因作为输入 |
| `done` | 汇报「本次验证已完成」，退出 |

详见 [`references/resume-protocol.md`](references/resume-protocol.md)。

### 0.2 状态更新原则

- **先写状态，再动手**。每个 Stage 结束、每条用例跑完、每次闸门通过，都必须先调用 `scripts/update_state.sh` 更新 § 0，再进入下一步。
- **禁止手改 § 0 的 YAML**。所有写入走 `update_state.sh`（内部用 flock + PyYAML 原子替换）。
- **只 append 历史**。§ 7 执行记录、§ 8 失败根因永远追加，不覆盖。

---

## 一、能力边界

| 能力 | 说明 |
|------|------|
| ✅ 改动梳理 | 基于 `git log` / `git diff` 定位「当前分支 / 当前开发者」的真实改动，排除 merge / 他人提交 |
| ✅ 测试范围确认 | 强制走「范围确认」闸门，由业务/开发共同锁定要覆盖的用例集 |
| ✅ 链路影响分析 | 对改动代码梳理入口 → 调用链 → 下游依赖（DB / MQ / 缓存 / 外部 JSF / HTTP） |
| ✅ 测试方案输出 | 结构化方案：前置、步骤、预期、验证点、回滚方式，落成 md 交接文档 |
| ✅ HTTP / OpenApi 调用 | 有 `@OpenApi` / Controller 时**优先** curl/HTTP；见 [`references/http-openapi-invoke.md`](references/http-openapi-invoke.md) |
| ✅ JSF IP 直连执行 | 仅 JSF 入口或 HTTP 不可用时；泛化调用命中指定 IP:PORT，不走注册中心/泳道 |
| ✅ DB 数据核对 | 复用 db-query，执行前后对比、变化差值列表；查询过程免确认 |
| ✅ 日志根因初判 | 复用 log-search，按 traceId / businessNo 拉日志与上下文 |
| ✅ 失败结构化汇报 | 生成「测试内容 / 预期 / 结果 / 问题根因」四列表，并询问是否启动 bug-fix |
| ❌ 不做修复动作 | 不改业务代码、不推 Git；发现缺陷仅定位根因，修复交给 bug-fix skill |

## 二、依赖 Skill（横向能力）

| 场景 | 依赖 skill | 触发点 |
|------|-----------|--------|
| DB 数据核对 / 表结构 / 数据修改前后差值 | **db-query** | 收集测试前置数据、执行后核对；**中间过程无需向用户确认** |
| 日志检索 / traceId 追踪 / 异常堆栈 | **log-search** | 执行失败或需要根因辅助定位时 |
| SSO 登录态 | **jd-token-tool** | db-query / log-search 前置依赖，缓存过期时静默刷新 |
| Bug 修复 | **bug-fix** | 用户选择「开启修复」时立即切换 |
| 京 ME 消息通知（可选） | **jm-notify** | 闸门通知（可选，未安装则跳过）|

依赖检测由 `scripts/gen_test_plan.sh` 前置探测，缺失则打印明确指引，不阻断主流程。

## 三、目录结构

```
function-test/
├── SKILL.md                              # 本文档（工作流与协作协议）
├── scripts/
│   ├── collect_diff.sh                   # 收集当前分支 + 当前开发者的改动清单
│   ├── gen_test_plan.sh                  # 生成测试方案 md 骨架（自带 §0 状态块）
│   ├── jsf_invoke.sh                     # JSF 泛化调用 IP 直连封装（仅 jsf_only 时用）
│   └── update_state.sh                   # §0 状态块原子更新工具（flock + PyYAML）
└── references/
    ├── change-analysis.md                # 改动梳理与链路影响规范
    ├── test-plan-template.md             # 测试方案 md 模板（含 §0 状态块）
    ├── http-openapi-invoke.md            # HTTP/OpenApi 调用指引（优先入口）
    ├── jsf-direct-invoke.md              # JSF IP 直连使用指引
    ├── failure-report-template.md        # 失败汇报模板
    └── resume-protocol.md                # 断点续跑协议规范（跨模型可续跑）
```

---

## 四、协作协议（强制）

### 4.1 逐步汇报

每完成一步用 1~3 句话简要汇报；非闸门步骤自动推进，无需等待。

### 4.2 确认闸门（必须等用户回复）

| 闸门 | 时机 | 未确认前禁止 |
|------|------|--------------|
| **改动确认** | 改动梳理完成、区分了「当前开发者 / 当前分支」的净改动 | 生成测试方案 |
| **范围确认** | 与需求方/开发者对齐要覆盖的功能点、场景、边界用例 | 开始执行验证 |
| **执行入口确认** | 缺测试入口信息时（HTTP base URL **或** JSF host，按入口类型二选一） | 发起真实调用 |
| **失败处置** | 出现验证不通过的用例，用户在「开启修复 / 自行解决」间选择 | 切 bug-fix 或结束 |

### 4.3 免确认动作（默认自动执行）

- 只读 `git log` / `git diff` / `git blame`
- **db-query 只读查询**（SELECT / SHOW / DESC）—— 用户已授权，中间过程不再问
- log-search 检索
- jd-token-tool 静默刷新 token

### 4.4 KISS 原则

- 用最少的工具组合达成目的：有 HTTP 入口就不强行走 JSF；能一条 SQL 核对就不拆多条。
- 方案写完先落盘为 md 文件，后续所有轮次都在同一份文件上迭代（handoff 风格）。

---

## 五、工作流总览

```
┌────────────────────────────────────────────────────────────────┐
│ Stage 1  改动梳理【闸门：改动确认】                              │
│   ├─ 当前分支 vs base 分支（默认 origin/master）                 │
│   ├─ 过滤 merge commit、他人 commit（按 git config user.email）  │
│   └─ 输出：文件清单 + commit 摘要 + 影响模块                    │
├────────────────────────────────────────────────────────────────┤
│ Stage 2  测试范围确认【闸门：范围确认】                          │
│   ├─ 与业务/开发共同锁定「必测 / 可选 / 不测」用例集             │
│   └─ 输出：范围清单，写入方案 md                                 │
├────────────────────────────────────────────────────────────────┤
│ Stage 3  链路影响分析                                            │
│   ├─ 入口（Controller / JSF Provider / MQ Listener / Job）      │
│   ├─ 调用链（Service → Manager → Mapper / RPC / 缓存）           │
│   ├─ 下游依赖（DB 表 / MQ Topic / Redis Key / 外部 JSF）         │
│   └─ 输出：链路图（Mermaid）+ 影响面表                           │
├────────────────────────────────────────────────────────────────┤
│ Stage 4  测试方案设计                                            │
│   ├─ 用例设计：前置 / 步骤 / 预期 / 数据核对点                   │
│   ├─ 执行方案：调用方式（JSF/HTTP）、参数、IP 直连信息           │
│   └─ 输出：test-plan.md（handoff 结构，可交接）                  │
├────────────────────────────────────────────────────────────────┤
│ Stage 5  执行验证【闸门：执行入口确认】                          │
│   ├─ 选定入口：OpenApi/Controller → HTTP 优先；仅 JSF → 直连     │
│   ├─ 采前置快照（db-query）                                      │
│   ├─ 触发调用（curl / jsf_invoke.sh）                          │
│   ├─ 采执行后快照 → 与预期比对                                   │
│   └─ 失败：拉日志（log-search）+ 根因初判                        │
├────────────────────────────────────────────────────────────────┤
│ Stage 6  结果汇报                                                │
│   ├─ 通过：Pass 摘要 + 数据差值表                                │
│   └─ 不通过【闸门：失败处置】                                    │
│       ├─ 失败用例数量 + 四列表格                                 │
│       ├─ 每条根因结论                                            │
│      └─ 询问：开启修复（→ bug-fix） / 用户自行解决              │
└────────────────────────────────────────────────────────────────┘
```

---

## 六、Stage 详解

### Stage 1 — 改动梳理（闸门：改动确认）

**目标**：只对「当前开发者 + 当前分支」的净改动做测试，避免把 base 分支或他人的代码算进来。

**执行**：

```bash
FT="${FT_DIR:-${JOYCODE_SKILLS_DIR:-$HOME/.joycode/skills}/function-test}"
bash "$FT/scripts/collect_diff.sh" \
  --repo <项目根目录> \
  --base <base分支，默认 origin/master> \
  --author-only true
```

脚本会：

1. `git fetch --no-tags -q` 拉最新 base
2. `git log <base>..HEAD --author="$(git config user.email)" --no-merges` 拿当前开发者的 commit
3. `git diff --name-status <base>...HEAD` 拿净改动文件
4. 输出：
   - `commits`（sha / subject / time）
   - `files`（A/M/D + 路径 + 所属模块）
   - `authors`（区分自己 vs 其他人）
   - `warnings`（如果 HEAD 上有非本人 commit 会点名）

**必答问题**（若脚本给出 warning）：

- HEAD 上包含非当前开发者的 commit `<sha>`，是要一起测还是只测自己的？

**闸门产物**：以下清单写入 `test-plan.md` § 1 改动清单：

```markdown
## 1. 改动清单
- 当前分支：feature/xxx
- Base：origin/master
- 开发者：chuyaxin.5 <chuyaxin.5@jd.com>
- Commit 数：3（自己）+ 0（他人）
- 变更文件：
  - M src/main/java/.../XxxService.java
  - A src/main/java/.../YyyMapper.java
  - ...
```

**本 Stage 完成后写状态**（用户确认改动后调用）：

```bash
bash "$FT/scripts/update_state.sh" --plan <test-plan.md> \
  --set-gate change_confirmed=passed:"用户确认改动清单完整" \
  --set current_stage=stage2_scope \
  --set-blocked-on scope_confirmed \
  --set-next-action '{"kind":"ask_user","prompt":"请审阅 §2 候选测试点并 pick 必测/可选/不测","stage":"stage2_scope","gate":"scope_confirmed"}'
```

### Stage 2 — 测试范围确认（闸门：范围确认）

对每个改动文件/接口，列出「候选测试点」，再由用户 pick / 补充：

```markdown
## 2. 测试范围
| # | 测试点 | 触发路径 | 必测 | 备注 |
|---|--------|----------|-----|------|
| 1 | 报损单创建 | JSF `StorageStockChangeGeneric#invoke` opType=33 | ✅ | 主流程 |
| 2 | 报损单取消 | 同上 opType=34 | ✅ | 边界：主库存锁定明细释放 |
| 3 | 报损出库 | 同上 opType=35 | ✅ | 高优：8.5 里报的 291072 |
| 4 | 盘点盘盈 | 同上 opType=... | ❌ | 未改动，冒烟即可 |
```

**必答问题**：

- 上面清单是否覆盖全，需不需要加/去？
- 每个用例的**验收人**是谁（开发者本人 or 产品/测试）？

**本 Stage 完成后写状态**：

```bash
bash "$FT/scripts/update_state.sh" --plan <test-plan.md> \
  --set-gate scope_confirmed=passed:"共 N 条必测用例" \
  --set current_stage=stage3_impact \
  --set-blocked-on null \
  --set-next-action '{"kind":"ask_user","prompt":"链路影响分析完成，请审阅 §3","stage":"stage3_impact","gate":"impact_confirmed"}'
```

### Stage 3 — 链路影响分析（自动，无闸门）

对每个测试点，用 grep_search / symbol_search 定位入口与调用链，并**判定首选执行入口**：

| 源码信号 | `entry_kind` | Stage 5 首选 |
|---------|--------------|-------------|
| `@OpenApi(outerUrl=...)` | `http_openapi` | HTTP（记录 `http_path`） |
| `@RestController` / `@RequestMapping` | `http_controller` | HTTP |
| JSF `@BootService` / `@Service` 且无 HTTP 映射 | `jsf_only` | JSF 直连 |
| 两者皆有（常见） | `http_and_jsf` | **先验证 Pod 端口**（见 Stage 5.0.1）；HTTP 不可达则 **`jsf_primary`** |

写入 test-plan §3 的「入口」与 §5 的 `entry_kind` / `http_path`，并继续分析：

- 入口方法（Controller/Provider/OpenApi）
- 关键调用链（3~5 层，过滤 Spring 框架层）
- DB 表读写（分库分表规则一并记录）
- 是否走缓存 / 消息 / 定时任务

**产物**：

```markdown
## 3. 链路影响
### 3.1 报损出库 opType=35
- 入口：StorageStockChangeGenericImpl#invoke
- 调用链：
  - StorageStockChangeAtomHandlerChain
  - → LossReportOutboundAtomHandler
  - → StorageStockCalc.applyOutbound
  - → StorageStockBizDataSaveService.saveBizData
- DB 影响：
  - stock_erp_${erpOrgCode % 64}       -- 主库存
  - storage_stock_erp_${erpStationNo % 100}  -- 储位
  - batch_stock_erp_${erpOrgCode % 64}  -- 批次
  - storage_stock_lock                  -- 储位锁定明细（本次风险点）
  - stock_transit_lock                  -- 主库存锁定明细
- 缓存影响：Redis storageStockLock:*、stockTransitLock:*
```

### Stage 4 — 测试方案设计

调用：

```bash
bash "$FT/scripts/gen_test_plan.sh" \
  --repo <项目根目录> \
  --title "<变更主题>" \
  --output <目标 md 路径>
```

脚本生成 handoff 结构 md（模板见 [`references/test-plan-template.md`](references/test-plan-template.md)），至少包含：

- § 1 改动清单（Stage 1 产物）
- § 2 测试范围（Stage 2 产物）
- § 3 链路影响（Stage 3 产物）
- § 4 测试数据（引用现成/新建，标注 orgCode / stationNo / goodsId 等）
- § 5 执行方案（**入口类型**、HTTP base/path 或 JSF host、runId 规则）
- § 6 用例矩阵（前置 / 步骤 / 预期 / 数据核对点）
- § 7 执行记录（后续填充）
- § 8 失败根因（后续填充）

若输入来自 `xingyun-deploy` 的交接块，还应额外补充：

- 在 § 1 增加部署来源摘要：`app / env / branch / groups / artifact`
- 在 § 4 测试数据或 § 5 执行方案里标注测试基线来自“最新已部署版本”
- 若交接块已给出 `http_base_url` / `http_path` / `jsf_host`，则不要重复索要同一字段
- 有 `http_path` 但缺 base URL 时，**只问 base URL**，不要改问 JSF host

**本 Stage 完成后写状态**：

```bash
bash "$FT/scripts/update_state.sh" --plan <test-plan.md> \
  --set-gate plan_confirmed=passed:"用例矩阵 N 条已入 §6" \
  --set current_stage=stage5_execute \
  --set-blocked-on null \
  --append-pending-case '{"id":1,"name":"报损创建","status":"pending"}' \
  --set-next-action '{"kind":"ask_user","prompt":"请确认执行入口：HTTP 则提供 base URL；仅 JSF 则提供 ip:port","stage":"stage5_execute","gate":null}'
```

### Stage 5 — 执行验证（闸门：执行入口确认）

#### 5.0 入口选择（强制，先于任何调用）

1. 读 §3 / 交接块 `test_entry`，确定 `entry_kind`
2. **eone / 行云 Pod 部署**：先执行 **5.0.1 端口探测**（不可仅凭 `application.yml` 假设 HTTP 可用）
3. **`http_openapi` / `http_controller` / `http_and_jsf`** 且 Pod **已确认 HTTP 监听** → 走 HTTP（见 [`references/http-openapi-invoke.md`](references/http-openapi-invoke.md)）
4. **`jsf_only`** 或 **HTTP 在 Pod 未监听** → 走 JSF（见 [`references/jsf-direct-invoke.md`](references/jsf-direct-invoke.md)）
5. **禁止**无 HTTP 映射时强行 HTTP；**禁止** eone Pod 上 HTTP 未验证时就死磕 curl

#### 5.0.1 eone Pod 端口探测（有 podIP 时必做）

**不要**直接用 `application.yml` 的 `server.port` 拼 URL — eone Pod 上 HTTP 常未监听。

| 步骤 | 命令（Pod 内或请用户执行） | 判定 |
|------|---------------------------|------|
| 1 | `jps` → 找应用 PID | 确认进程 |
| 2 | `lsof -p <pid> -i -P -n \| grep LISTEN` | 拿**数字端口**（勿用服务名别名） |
| 3 | JSF 端口 | 读 Pod 内 `/export/App/conf/profile/jsf.properties` 的 `dong.jsf.servers.server1.port`（常见 **22001**）；与 lsof 交叉验证 |
| 4 | HTTP | 仅当 lsof **出现** `server.port` 对应端口时，才填 `http_base_url` |
| 5 | 连通 | `echo > /dev/tcp/127.0.0.1/22001`（无 nc 时）；或请用户 Pod 内 curl |

**常见 eone 现象**（实测）：

- JSF **22001** + 平台附加端口（如 50020）同时 LISTEN → **优先 22001**（与 jsf.properties 一致）
- `server.port`（如 28080）**不在 LISTEN** → `entry_kind` 降为 **`jsf_primary`**，不写 http_base_url
- `proxyHttpPort=50015` **不等于**应用 HTTP，curl 常报 `proxyconnect ... 127.0.0.1:80 refused`

探测结果写入 §5 / STATE `deployment.pod_listen_ports`、`jsf_host`、`http_port_pod_status`。

#### 5.1 执行入口确认闸门

**若交接块 / §5 已具备经 5.0.1 验证的可调用 JSF host，或已验证的 HTTP URL，直接执行，不开闸门。**

若缺测试数据且 db-query 查不到：**同一轮闸门须同时提供「先部分验证」选项**（hb-choices），**禁止**只索要 pin/erpOrgCode 导致任务空等超时。

```markdown
## hb-choices
- 提供测试用户 pin + erpOrgCode | （自由输入）
- 先部分验证（静态 + 端口探测 + 结案） | 先部分验证
```

否则按 `entry_kind` **只问缺的那一项**：

| entry_kind | 向用户索要 | 不要问 |
|------------|-----------|--------|
| `http_*` | Pod IP + **已验证** HTTP 端口；未验证则改 JSF | 未监听时仍问 HTTP |
| `jsf_only` / `jsf_primary` | JSF **ip:port**（优先 jsf.properties 端口） | HTTP base |
| `http_and_jsf` | 5.0.1 后 HTTP 可达则 base；否则 **仅 JSF** | 假设 28080 一定通 |

**不允许**通过注册中心 / 泳道 JSF 调用。

#### 5.2 无测试数据时的降级（勿无限阻塞）

若缺 pin / erpOrgCode 等且 db-query 查不到，**不得停在闸门死等**。按序降级：

1. **静态验证**：`git show` / 读源码确认缺陷行已修复
2. **编译/单测**：有则跑改动模块相关 test
3. **最小 HTTP/JSF 探测**：空 body 或缺参请求 — 预期业务校验错误，**不应**再出现原缺陷堆栈（如 `ArithmeticException`）
4. **日志回放**：用工单 traceId + 部署后时间窗 log-search
5. §9 结论标 **「部分验证」**，`verification_level: partial`，`current_stage: done`；列出未覆盖项；**立即结案**，勿再开闸门索要测试用户

**HTTP 执行示例**：

```bash
curl -sS -X POST "${HTTP_BASE}${HTTP_PATH}" \
  -H "Content-Type: application/json" \
  -d @/tmp/case-01.json
```

**JSF 执行示例**（仅 `jsf_only` 或 HTTP 不可用时）：

```bash
# 5.1 前置快照
SKILLS="${JOYCODE_SKILLS_DIR:-$HOME/.joycode/skills}"
bash "$SKILLS/db-query/scripts/query.sh" \
  <app> <ds> <env> "<snapshot SQL>"

# 5.2 触发调用
bash "$FT/scripts/jsf_invoke.sh" \
  --host 6.244.233.39:22012 \
  --interface com.yzt.stock.erp.api.StorageStockChangeGeneric \
  --method invoke \
  --param-file /tmp/param-BS-OUT-08181530.json \
  --run-id 08181530

# 5.3 事后快照 + 对比
SKILLS="${JOYCODE_SKILLS_DIR:-$HOME/.joycode/skills}"
bash "$SKILLS/db-query/scripts/query.sh" \
  <app> <ds> <env> "<snapshot SQL>"

# 5.4（可选）失败时拉日志
bash "$SKILLS/log-search/scripts/log_search.sh" \
  --keyword "<traceId or businessNo>" \
  --appName <app> --systemName <sys> --env <env> \
  --pin "$(git config user.name)" \
  --startTime <ms> --endTime <ms>
```

每条用例执行完立即写入 § 7 执行记录（append，绝不覆盖历史）。

**每条用例跑完后写状态**（关键：先写状态再跑下一条，中断可续）：

```bash
# 用例通过
bash "$FT/scripts/update_state.sh" --plan <test-plan.md> \
  --append-run '{"run_id":"08181530","case_id":1,"result":"pass","code":0,"trace_id":"..."}' \
  --remove-pending-case-id 1 \
  --set-next-action '{"kind":"run_case","stage":"stage5_execute","gate":null}'

# 用例失败
bash "$FT/scripts/update_state.sh" --plan <test-plan.md> \
  --append-run '{"run_id":"08181530","case_id":3,"result":"fail","code":291072,"trace_id":"..."}' \
  --remove-pending-case-id 3 \
  --set-next-action '{"kind":"run_case","stage":"stage5_execute","gate":null}'

# 全部跑完 → 进入 Stage 6
bash "$FT/scripts/update_state.sh" --plan <test-plan.md> \
  --set-gate execute_done=passed:"pending_cases 已清空" \
  --set current_stage=stage6_report \
  --set-next-action '{"kind":"write_report","stage":"stage6_report","gate":"report_done"}'
```

### Stage 6 — 结果汇报

**全部通过时**：

```markdown
## 结果：✅ 全部通过（<N> 条）
| # | 用例 | 关键差值 |
|---|------|----------|
| 1 | 报损创建 | stock_lock +5、储位 +5 |
| ... | ... | ... |
```

**存在不通过时【闸门：失败处置】**（模板见 [`references/failure-report-template.md`](references/failure-report-template.md)）：

```markdown
## 结果：❌ 测试不通过 <N> 条

| 测试内容 | 预期 | 结果 | 问题根因 |
|----------|------|------|----------|
| 报损出库 opType=35 | stock -5、stock_lock -5、storage 归 0 | code=291072「储位库存更新失败」，回滚 | `storage_stock_lock` 缓存明细缺主键 id，`updateByPrimaryKeySelective` 命中 `id=null` → 更新 0 行 |
| 报损取消 opType=34 | 释放 stock_transit_lock 明细 | 响应成功但明细未释放 | 同类 id 缺失 + delete 未校验 rows |

**处置选择**：
- ⚡ 开启修复 → 立即启动 `bug-fix` skill，携带上述根因结论进入根因定位阶段
- 👋 我自己解决 → 结束本次验证，方案 md 已归档

请回复：**开启修复** 或 **我自己解决**
```

用户回复「开启修复」时，直接切到 bug-fix skill，把 § 8 根因结论作为 bug-fix 的输入。

**Stage 6 完成后写状态**（收尾）：

```bash
# 全通过
bash "$FT/scripts/update_state.sh" --plan <test-plan.md> \
  --set-gate report_done=passed:"结论已入 §9" \
  --set current_stage=done \
  --set-blocked-on null \
  --set-next-action '{"kind":"done"}'

# 需切 bug-fix
bash "$FT/scripts/update_state.sh" --plan <test-plan.md> \
  --set-gate report_done=passed:"失败 N 条，根因已入 §8" \
  --set current_stage=done \
  --set-next-action '{"kind":"handoff_bugfix","prompt":"根因已就位，请启动 bug-fix skill","stage":"done","gate":null}'
```

---

## 七、参数与 IO 约定

### 7.1 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `FT_DIR` | function-test 根目录 | `${JOYCODE_SKILLS_DIR:-~/.joycode/skills}/function-test` |
| `FT_OUTPUT_DIR` | 测试方案 md 输出目录 | `<repo>/.harness/changes/<change-id>/` |
| `FT_JSF_DEFAULT_TIMEOUT` | JSF 调用默认超时（ms） | `30000` |

### 7.2 常见错误

| 错误 | 处理 |
|------|------|
| `git diff` 空 | 分支未提交或误传 base；提示用户确认分支状态 |
| JSF `no provider` | 未走 IP 直连；提示改用 `--host` 参数 |
| `db-query` SQL_BLOCKED | 白名单只允许 SELECT/SHOW/DESC；换查询语句 |
| token 过期 | 自动触发 jd-token-tool `--no-cache` 后重试一次 |
| 无 `.harness/changes` 目录 | 首次运行由 `gen_test_plan.sh` 创建 |

---

## 八、快速命令模板

```bash
# 一站式：改动 → 方案 → 执行
FT="${FT_DIR:-${JOYCODE_SKILLS_DIR:-$HOME/.joycode/skills}/function-test}"
REPO="<业务仓库根目录>"
CHANGE_ID="20260818-001-示例变更"

# 1) 改动收集
bash "$FT/scripts/collect_diff.sh" --repo "$REPO" --base origin/master --author-only true

# 2) 生成方案骨架
bash "$FT/scripts/gen_test_plan.sh" \
  --repo "$REPO" \
  --title "$CHANGE_ID" \
  --output "$REPO/.harness/changes/$CHANGE_ID/test-plan.md"

# 3a) HTTP 执行（有 @OpenApi 时优先）
# curl -sS -X POST "${HTTP_BASE}/base-pay/xxx/page" -H "Content-Type: application/json" -d @/tmp/case-01.json

# 3b) JSF 直连（仅 jsf_only 时）
bash "$FT/scripts/jsf_invoke.sh" \
  --host 6.244.233.39:22012 \
  --interface com.example.api.YourService \
  --method yourMethod \
  --param-file /tmp/case-01.json \
  --run-id $(date +%m%d%H%M)
```

---

## 九、与其他 skill 的边界

- 本 skill **不做代码修改** —— 修复交给 bug-fix。
- 本 skill **不做 CR/评审** —— 评审走 code-reviewer。
- 本 skill 是 **单分支功能验证**，不是集成/回归测试平台；跨系统联调请附加人工验证节点。

## 十、出口

- 全通过 → 方案 md 归档，通知用户可提测/合并
- 存在失败 → 闸门等待用户决策；选「开启修复」则挂接 bug-fix，选「自行解决」则归档方案 md 供后续复盘
