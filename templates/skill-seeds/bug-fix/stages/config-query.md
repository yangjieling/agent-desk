# Config Query（配置查询）

> **横向能力（步骤 6.5）**：贯穿「步骤 7 根因分析」与「步骤 11 验证」。
> 当 Bug 特征命中「配置驱动」信号时，AI **必须主动调用**配置查询脚本，禁止凭经验猜测。
> 本能力**不单独开闸门**；结论写入根因分析与验证记录。

---

## 任务

在 Bug 排查过程中查询线上实际生效的配置（DUCC 配置项 / 数据库连接串），
用真实数据替代「我以为配置是 X」的猜测，快速定位以下类型问题：

- 开关/降级：某能力被配置关闭
- 限流阈值：QPS/TPS 被调低导致请求被拒
- 白名单/黑名单：目标 pin 是否在名单中
- 数据源：连接串指向错误的库、只读实例、无 SSL
- 路由/分片规则：Sharding 规则错配
- 灰度策略：某个 profile 被错误发布到生产

---

## 触发时机（AI 主动调用）

**从日志、异常、用户描述中命中以下关键词 → 立刻查配置，不要绕过。**

| 触发信号 | 配置查询目标 | 调用脚本 |
|---------|-------------|---------|
| 「限流」/「rate limit」/「429」/「QPS 超」 | 限流阈值配置 | `check_ducc_config_item.sh ... "rateLimit"` |
| 「降级」/「熔断」/「fallback」/「circuit」 | 降级开关 | `check_ducc_config_item.sh ... "switch"/"degrade"` |
| 「白名单」/「whitelist」/「blacklist」/「权限拒绝」 | 名单类配置 | `check_ducc_config_item.sh ... "whiteList"` |
| 「数据源」/「连不上库」/「jdbc」/「connection refused」/「读到旧数据」 | 数据源连接串 | `check_dbs_datasource.sh <appCode>` |
| 「分片错」/「路由错」/「sharding」 | 分片规则 | `check_ducc_config_item.sh ... "sharding"` |
| 「灰度未生效」/「profile 错」 | profile 列表 | `check_ducc_profiles.sh <appId>` |
| 「配置刷新失败」/「读到旧配置」 | 配置发布状态 `isReleased` | `check_ducc_config_item.sh` |
| 需要核对线上数据行 | 只读 SQL | `check_dongdal_sql.sh` 或 **db-query** `query.sh` |

---

## 前置条件

### SSO 登录态

所有查询依赖 SSO 登录态（优先 `~/.jdtoken/jd-sso-token.json`，兼容 `~/.joyclaw/workspace/jd-sso-token.json`）。
通过 **jd-token-tool** skill 获取：

```bash
bash "${JOYCODE_SKILLS_DIR:-$HOME/.joycode/skills}/jd-token-tool/scripts/get_token.sh"
bash "${JOYCODE_SKILLS_DIR:-$HOME/.joycode/skills}/jd-token-tool/scripts/get_token.sh" --no-cache  # 强制刷新
```

### 脚本路径解析

```bash
BUG_SCRIPTS="$(bash -c 'source scripts/resolve_tools.sh; resolve_bug_fix_scripts')"
# 或环境变量 BUG_FIX_DIR 指向 bug-fix skill 根目录
```

### 参数准备

从「步骤 2 输入识别」带出：
- `appCode`（应用编码，如 `yzt-base-pay-gateway`）
- `env`（test / staging / prod，用于筛选 profile）
- 可选：`profileHint`（明确知道要查哪个 profile 时）

---

## 执行步骤

### 步骤 1：确认应用在 DUCC 已注册

```bash
bash "$BUG_SCRIPTS/check_ducc_app.sh" "<appCode>"
```

**输出（JSON）**：`{"status":"success","appId":"...","appCode":"...","records":[...]}`

**分支**：
- `status=success` → 记录 `appId`，进入步骤 2
- `status=not_found` → 未接入 DUCC；跳过 DUCC 项查询，仍可查 DBS 连接串
- `status=error` → token/网络问题；刷新 token 后重试一次

### 步骤 2：列出 profile 三元组

```bash
bash "$BUG_SCRIPTS/check_ducc_profiles.sh" "<appId>"
```

**匹配策略**：
- Bug 在生产 → 优先 `profileCode=prod`
- Bug 在灰度 → 优先 `profileCode=gray`
- 不确定 → 全部查一遍并对比

### 步骤 3：查具体配置项

```bash
bash "$BUG_SCRIPTS/check_ducc_config_item.sh" \
     "<namespaceId>" "<configId>" "<profileId>" "<itemName>"
```

- `itemName` 支持**前缀模糊匹配**
- **不要用截断 value**：连接串、白名单要看完整 value

**关键字段**：

| 字段 | Bug 定位价值 |
|-----|-------------|
| `value` | 与代码/日志期望值对比 |
| `isReleased=false` | ⚠️ 改了但未发布，线上仍是旧值 |
| `updateTime` | 与 Bug 首次出现时间对比 |
| `updateBy` | 配置变更责任人 |

### 步骤 4：数据库连接串 / 只读 SQL

**连接串反查**（推荐，底层转发 **db-query**）：

```bash
bash "$BUG_SCRIPTS/check_dbs_datasource.sh" "<appCode>" [profileHint]
```

**只读 SQL**（需已知 app/ds/env）：

```bash
bash "$BUG_SCRIPTS/check_dongdal_sql.sh" "<app>" "<ds>" "<env>" "<SELECT ...>"
# 或直接使用 db-query skill 的 query.sh（含 SQL 白名单校验）
```

若 value 为 `${dbs.xxx}` 逻辑名 → 调用 `check_dbs_platform.sh` 获取人工排查引导。

---

## 截止条件

### 成功

- 至少查到 1 条**与 Bug 相关**的配置项，且 value / isReleased / updateTime 已纳入根因分析
- 或明确证明「未接入 DUCC / 无相关配置项」→ 排除配置驱动可能

### 失败

- jd-token-tool 也无法拿到有效 SSO → 记录并降级为「要求用户手动查配置」
- DUCC 接口连续失败 3 次 → 记录网络异常，进入人工核查

---

## 输出（必须写入根因分析）

- 关键配置项：`key = value`
- 发布状态 `isReleased`
- 最近修改时间与修改人
- 配置值与代码期望是否一致
- 结论：**「配置驱动」** 或 **「排除配置因素」**

---

## 反模式（禁止）

- ❌ 凭记忆猜配置
- ❌ 只看代码默认值不查线上生效值
- ❌ 只看一个 profile，不对比 prod / gray / staging
- ❌ 忽略 `isReleased=false`
- ❌ 用截断的 value 判断
- ❌ 脚本能查却让用户手动上 taishan/DUCC 控制台

---

## 与其他步骤的关系

| 上游 | 传入 | 下游 | 传出 |
|------|------|------|------|
| 步骤 2 input-recognition | appCode / env | 步骤 7 root-cause-analysis | 配置项列表 + 结论 |
| 步骤 7 root-cause-analysis | 根因假设 | 步骤 8 fix-generate | 配置变更建议（若根因是配置） |
| 步骤 8 fix-generate | 待发布配置 | 步骤 11 verify | 修复后再次查询确认 |

**步骤 11 verify**：若修复涉及配置变更，**必须**再次调用 `check_ducc_config_item.sh`，确认 `isReleased=true` 且 value 符合预期。

**与 checkList 的关系**：上线检查（步骤 12）仍走 `checklist-check.md` 的 DUCC 检查项；本阶段侧重 **Bug 根因排查**，二者互补不替代。

**与 db-query 的关系**：`check_dbs_datasource.sh` / `check_dongdal_sql.sh` 为兼容入口，底层复用 **db-query** skill，避免重复维护。
