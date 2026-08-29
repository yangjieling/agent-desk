# 改动梳理与链路影响规范

## 一、改动收集原则

### 1.1 归属过滤

- **仅统计当前开发者**：默认按 `git config user.email` 过滤 commit，其余 commit 提醒用户单独确认。
- **过滤 merge commit**：`--no-merges`；避免把合入 base 的历史算成本次改动。
- **base 分支**：默认 `origin/master`；若项目主干是 `main` / `develop`，通过参数覆盖。

### 1.2 diff 策略

- 使用 `git diff --name-status <base>...HEAD` 拿净改动（三点差异）；避免把 base 上的新提交算进来。
- 追加 `git log <base>..HEAD --author=<email> --no-merges --oneline` 校验自己 commit 数。
- 若 `git diff` 空但 `git log` 非空 —— 已被 rebase 吸收，正常；`git diff` 非空但 `git log` 空 —— 未提交，提醒用户先 commit。

### 1.3 归类

对文件路径按启发式归类为模块，便于后续链路分析：

| 路径关键字 | 归类 |
|-----------|------|
| `*api*/src/main/java/**` | API 契约 |
| `*handler*` / `*command*` | Handler / 命令处理 |
| `*service*` / `*manager*` | 业务服务 |
| `*mapper*` / `*dao*` / `resources/mybatis` | 数据访问 |
| `*consumer*` / `*listener*` | MQ 消费 |
| `*controller*` / `*rest*` | HTTP 入口 |
| `resources/*.xml` / `*.yaml` | 配置 |
| `*test*` / `src/test/**` | 测试代码（不计入功能面） |

---

## 二、链路影响分析套路

### 2.1 定位入口

对每个改动接口方法，反查：

- **JSF Provider**：`@BootService` / `@Service`（JSF）+ 接口签名对应的 impl
- **OpenApi HTTP**：`@OpenApi(outerUrl=...)`（海博 OpenApi，**function-test 优先**）
- **HTTP Controller**：`@RestController` / `@RequestMapping`
- **MQ Listener**：`MessageListener` / `AbstractListener` 子类
- **定时任务**：`@Scheduled` / TBSchedule Worker / xxl-job Handler

### 2.1.1 选定 Stage 5 首选入口（写入 `entry_kind`）

| 检测结果 | `entry_kind` | 执行方式 |
|---------|--------------|---------|
| 仅有 OpenApi/Controller | `http_openapi` / `http_controller` | HTTP curl |
| 仅有 JSF Provider | `jsf_only` | JSF IP 直连 |
| JSF + OpenApi 并存 | `http_and_jsf` | **HTTP 优先**；JSF 作备选 |

详见 [`http-openapi-invoke.md`](http-openapi-invoke.md)。

### 2.2 调用链回溯（3~5 层足够）

- 用 grep/symbol search 从入口逐层下钻
- 遇到 Spring AOP / 拦截器 / 事务模板类，直接跳过其内部，只标注"经过"
- 到 Mapper 或对外 RPC 就停

### 2.3 下游依赖清单

分类列出：

- **DB 表**（**必须记录分片规则**，例如 `stock_erp_${erpOrgCode % 64}`）
- **Redis Key 模式**（附 TTL 与失效场景）
- **MQ Topic**（生产者 or 消费者）
- **外部 JSF/HTTP**（服务名 + 方法 + IP 段）
- **本地缓存**（Guava / Caffeine，注意刷新触发点）

### 2.4 风险点识别

在链路上标注「本次改动落在哪一层」，并列出常见风险类别：

| 类别 | 检查项 |
|------|--------|
| 数据一致性 | 是否有先写主表再写从表；异常回滚是否覆盖所有写点 |
| 幂等 | 相同 businessNo 二次调用是否安全；MQ 重投消费者是否幂等 |
| 缓存对齐 | 缓存对象是否含主键 id；db 更新后是否失效缓存 |
| 分片路由 | 计算 shard 的字段是否始终非空；跨分片查询是否被拆散 |
| 事务边界 | RPC 调用是否放在事务里；长事务风险 |
| 空值 / 边界 | 数量为 0、负数、null 时行为是否符合预期 |
| 灰度 | 是否有 DUCC / 泳道开关；关闭态行为是否安全 |

---

## 三、产物格式（写入 test-plan.md § 1 / § 3）

### § 1 改动清单

```markdown
## 1. 改动清单
- 项目：<name>
- 分支：feature/xxx（HEAD sha: abc1234）
- Base：origin/master
- 开发者：<name> <email>
- 本人 commit：3；他人 commit：0

### 1.1 Commits
| SHA | 时间 | 主题 |
|-----|------|------|
| abc1234 | 2026-08-18 14:30 | feat: xxx |

### 1.2 文件变更（分模块）
#### API 契约
- M yzt-stock-erp-api/src/main/java/.../StorageStockChangeParam.java

#### 业务服务
- M yzt-stock-erp-service/.../StorageStockCalc.java
- A yzt-stock-erp-service/.../LossReportOutboundAtomHandler.java

#### 数据访问
- M yzt-stock-erp-service/resources/mybatis/StorageStockLockMapper.xml
```

### § 3 链路影响

```markdown
## 3. 链路影响
### 3.1 <测试点名>
- 入口：<class#method>
- 调用链：
  - A → B → C → D
- DB 表：
  - <table>（分片规则：<rule>）
- 缓存：
  - Redis <key-pattern>
- MQ：
  - Topic <topic-name>（生产 / 消费）
- 外部依赖：
  - JSF <interface#method>
- 本次改动落点：<层>
- 风险点：
  - <类别>: <描述>
```

---

## 四、常见坑

1. **git rebase 后 base 追不上**：`git fetch --no-tags -q origin master` 后再对比；否则 diff 会把已并入 master 的提交也算进来。
2. **分支从旧 base 拉出**：base 参数需要与项目分支策略一致，团队里若有 `dev` 主干，别默认 `master`。
3. **子模块**：Git submodule 的改动不会出现在主仓 diff 里，收集时特别关注 `.gitmodules` 变化。
4. **生成代码**：MyBatis Generator、protobuf 生成的文件建议归到"生成代码"分组，不列进测试点。
5. **重命名**：`git diff -M` 才能识别重命名；否则误报「删 A + 加 B」。