---
version: 2.0
applies_to: [java, mybatis, mysql]
rule_prefix: D
---

# Database Conventions

数据库专项规则集。Step 4.3 数据库变更扫描时读取本文件。

**核心原则**：宁可提示风险，不要静默漏掉；但缺少闭合证据时必须标为"疑似 / 待确认"，不要把依赖业务前提、运行时配置或 SDK 语义的推断直接写成确认 P0。

---

## 一、扫描的四个维度（按优先级）

按以下顺序扫描，前一类未通过不阻塞后一类，但报告中必须按此分组：

| 顺序 | 维度 | 判断对象 | 目标 |
|:----:|------|----------|------|
| 1 | 需求对应关系 | Mapper XML / DAO 是否实现了 PRD 声明的数据库行为 | 防"漏实现 / 实现错位" |
| 2 | 索引规范 | SQL 写法是否能命中索引、索引定义是否合理 | 防慢 SQL / 全表扫描 |
| 3 | 死锁与并发 | 事务边界、加锁顺序、批量写入 | 防死锁 / 锁等待超时 |
| 4 | 通用规范 | Mapper XML / SQL / DDL 的写法约束 | 防低级错误 |

---

## 二、规则字段

每条 D 系列规则必须具备以下字段：

| 字段 | 说明 |
|------|------|
| `id` | 规则 ID，按维度编号（见下） |
| `severity` | P0 / P1 / P2 |
| `category` | `mapping` / `index` / `concurrency` / `convention` |
| `applies_to` | DDL / Mapper XML / Java DAO 等适用层 |
| `concept` | 问题语义指纹，必填，用于跨规则集去重 |
| `confidence` | `static` / `needs_schema` / `needs_runtime`。决定置信度标签与报告分组；不等同于确认违规 |
| `description` | 一句话规则 |
| `rationale` | 规则理由 |
| `anti_example` | 反例代码片段（至少 1 个，尽量贴近 MyBatis 真实写法） |
| `correct_example` | 正例代码片段 |

**ID 编号规则**：

- `D0xx` — 需求对应关系（mapping）
- `D1xx` — 索引规范（index）
- `D2xx` — 死锁与并发（concurrency）
- `D3xx` — Mapper / SQL 通用规范（convention）
- `D9xx` — DDL 字段定义（保留，扩展用）

---

## 三、置信度与报告处置（替代旧版"不可判定态"）

旧版当规则的 `requires` 不满足时直接标"不可判定"，导致联合索引未命中这类 P0 问题被静默吞掉。新版改为：

| confidence | 含义 | 报告处置 |
|------------|------|----------|
| `static` | 仅看代码就能判定 | 直接给结论；只有证据链闭合时才按 P0/P1/P2 计入确认违规 |
| `needs_schema` | 需要表结构或索引定义才能确认 | **仍然报**，结论前加 `🟡 疑似`，并在备注列出"待确认：X 字段是否在 (a, b, c) 联合索引中"；不默认计入确认 P0 |
| `needs_runtime` | 需要执行计划、实际数据分布、上游初始化链路、配置或 SDK 语义才能确认 | **仍然报**，结论前加 `🟡 疑似` / `待确认`，并列出待人工核对的信息；不默认计入确认 P0 |

`🟡 疑似` 项与确认违规分开统计。疑似项可以标注"影响可能达到 P0"，但除非已经拿到 PRD / DDL / 代码 / 运行时前提的闭合证据，否则不要触发确认 P0 或阻塞上线结论。

**证据闭合要求**：当结论依赖"某业务场景一定存在"、"同一 SKU 一定多渠道"、"上游一定不会提前初始化数据"、"内部 SDK 一定不是 CAS"、"某环境一定未开启配置"等前提时，若当前审查没有直接证据，只能写为 `🟡 疑似` 或 `待确认`。影响描述用条件句（如"若存在多渠道行，可能扩大更新范围"），避免写成"必然重复 N 倍"、"不可恢复"等确定性表述。

---

## 四、豁免标记

支持行内豁免，并在报告中单列豁免清单：

| 文件类型 | 格式 |
|----------|------|
| SQL / DDL | `-- review-skip: D101 reason=临时统计脚本` |
| Mapper XML | `<!-- review-skip: D102 reason=全表迁移脚本，已与 DBA 确认 -->` |
| Java DAO | `// review-skip: D201 reason=兼容旧字段长度` |

豁免必须带 `reason=`，无理由的豁免视为无效。

---

## 五、规则清单

### D0xx 需求对应关系

#### D001 Mapper 实现完整性

- `severity`: P0
- `category`: mapping
- `applies_to`: Mapper XML / Java DAO
- `concept`: `mapper_missing_for_requirement`
- `confidence`: static
- `description`: PRD 声明的数据库操作（增/删/改/查），必须在 Mapper 中有对应方法实现；方法名、入参、返回类型须与需求语义一致。
- `rationale`: 防"接口实现了但 SQL 没落地"或"SQL 落地但与需求语义不符"。
- `anti_example`: PRD 要求"按 (shop_id, status) 查询订单列表"，Mapper 实现 `selectByShopId(Long shopId)`，丢失 status 维度。
- `correct_example`: `selectByShopIdAndStatus(@Param("shopId") Long shopId, @Param("status") Integer status)`，参数与需求一致。

#### D002 SQL 语义与需求一致

- `severity`: P0
- `category`: mapping
- `applies_to`: Mapper XML / Java DAO
- `concept`: `sql_semantic_mismatch`
- `confidence`: static
- `description`: Mapper XML 中 SQL 的过滤条件、字段集合、排序、聚合必须与 PRD 声明完全一致，不得擅自增删条件或字段。
- `rationale`: 防"WHERE 漏一个条件导致查多""SELECT 少一个字段导致下游 NPE"。
- `anti_example`: PRD 要求"查未删除的有效订单 (`is_deleted=0 AND status=1`)"，Mapper 漏掉 `is_deleted=0`。
- `correct_example`: `WHERE is_deleted = 0 AND status = #{status}`

#### D003 事务边界与需求一致

- `severity`: P0
- `category`: mapping
- `applies_to`: Java Service / DAO
- `concept`: `tx_boundary_mismatch`
- `confidence`: static
- `description`: PRD 声明"需保证原子性"的多步数据库操作，Service 层必须用 `@Transactional` 包裹；未声明原子性的操作禁止滥用事务。
- `rationale`: 防"该有事务的没事务导致部分失败""不该有事务的乱加导致锁竞争"。
- `anti_example`: PRD 要求"扣减库存 + 写订单"原子，Service 方法两次调用 Mapper 但无 `@Transactional`。
- `correct_example`: `@Transactional(rollbackFor = Exception.class)` 标注 + 同一线程内执行。

#### D004 返回字段与上游契约一致

- `severity`: P1
- `category`: mapping
- `applies_to`: Mapper XML / DO / Entity
- `concept`: `resultmap_field_mismatch`
- `confidence`: static
- `description`: Mapper 返回字段、ResultMap 映射的列名必须与 DO/Entity 一致；ResultMap 缺列或列名拼写错会导致字段静默为 null。
- `rationale`: 字段映射错误不会编译报错，但会让下游业务字段为空，极难排查。
- `anti_example`: `<result column="shop_id" property="shopID"/>`，DO 字段叫 `shopId`，映射失败。
- `correct_example`: `<result column="shop_id" property="shopId"/>`，或开启驼峰映射并保持列名规范。

### D1xx 索引规范

#### D101 联合索引最左前缀

- `severity`: P0
- `category`: index
- `applies_to`: Mapper XML / Java DAO
- `concept`: `composite_index_leftmost_violation`
- `confidence`: needs_schema
- `description`: 使用联合索引 `(a, b, c)` 时，WHERE 必须包含最左列 `a`；跳过最左列直接查 `b` 或 `c` 不会命中索引。
- `rationale`: MySQL BTree 联合索引按最左前缀生效，跳列查询退化为全表扫描。
- `anti_example`:

```xml
<!-- 索引: idx_shop_status_created (shop_id, status, created_time) -->
<!-- 错误：跳过最左列 shop_id 直接查 status -->
SELECT id, shop_id, status FROM order_main WHERE status = #{status}
```

- `correct_example`:

```xml
SELECT id, shop_id, status FROM order_main
WHERE shop_id = #{shopId} AND status = #{status}
```

#### D102 索引列上不得套函数或表达式

- `severity`: P0
- `category`: index
- `applies_to`: Mapper XML / Java DAO
- `concept`: `index_column_wrapped`
- `confidence`: static
- `description`: 索引列上禁止套函数（`DATE()` / `LOWER()` / `IFNULL()`）或参与算术表达式，否则索引失效。
- `rationale`: 索引存储的是原值，函数包裹后无法走索引查找。
- `anti_example`:

```xml
WHERE DATE(create_time) = #{day}
```

- `correct_example`:

```xml
WHERE create_time >= #{dayStart} AND create_time < #{dayEnd}
```

#### D103 隐式类型转换

- `severity`: P0
- `category`: index
- `applies_to`: Mapper XML / Java DAO
- `concept`: `implicit_type_conversion`
- `confidence`: needs_schema
- `description`: `#{}` 入参 Java 类型必须与 DB 字段类型匹配；`bigint` 传 `String`、`varchar` 传 `Integer` 会触发隐式转换导致索引失效。
- `rationale`: 隐式转换发生在索引列上时索引失效，且很难从代码层一眼看出。
- `anti_example`: 字段 `user_id bigint`，Mapper 入参 `@Param("userId") String userId`，传入字符串导致索引失效。
- `correct_example`: 入参类型与 DB 一致 `@Param("userId") Long userId`。

#### D104 动态 SQL 破坏索引顺序

- `severity`: P0
- `category`: index
- `applies_to`: Mapper XML
- `concept`: `mybatis_dynamic_if_breaks_index`
- `confidence`: needs_schema
- `description`: `<if>` 动态拼接 WHERE 时，必须确保任意分支组合下都能命中已有索引；不得让某个高频分支跳过最左列。
- `rationale`: 动态 SQL 的"分支组合"远多于人脑能枚举，常见翻车场景是某个分支只剩非索引列。
- `anti_example`:

```xml
<!-- 索引: (shop_id, status)；shopId 可选时存在"只按 status 过滤"的分支 -->
<select id="list" resultType="OrderDO">
  SELECT id, shop_id, status FROM order_main
  <where>
    <if test="shopId != null"> AND shop_id = #{shopId} </if>
    <if test="status != null"> AND status = #{status} </if>
  </where>
</select>
```

- `correct_example`: shop_id 设为必填，或为单独按 status 的查询场景补建索引，或在 Service 层拒绝缺少 shopId 的查询。

#### D105 LIKE 前置通配

- `severity`: P1
- `category`: index
- `applies_to`: Mapper XML / Java DAO
- `concept`: `like_leading_wildcard`
- `confidence`: static
- `description`: `LIKE` 查询禁止以 `%` 开头，否则无法走 BTree 索引。
- `rationale`: 前置通配等同于全表扫描。
- `anti_example`: `WHERE name LIKE CONCAT('%', #{keyword}, '%')`
- `correct_example`: 后缀匹配 `LIKE CONCAT(#{keyword}, '%')`，或改用 ES / 倒排索引。

#### D106 != / NOT IN / IS NULL 不走索引

- `severity`: P1
- `category`: index
- `applies_to`: Mapper XML / Java DAO
- `concept`: `negative_predicate_index_miss`
- `confidence`: static
- `description`: `!=`、`<>`、`NOT IN`、`IS NULL`、`IS NOT NULL` 在大表上无法利用 BTree 索引；高频路径禁用。
- `rationale`: 负向条件无法在 BTree 上定位，退化为全表扫描。
- `anti_example`: `WHERE status != 0`
- `correct_example`: `WHERE status IN (1, 2, 3)` 显式列举正向值。

#### D107 排序方向与联合索引一致

- `severity`: P1
- `category`: index
- `applies_to`: Mapper XML / Java DAO
- `concept`: `order_by_direction_mismatch`
- `confidence`: needs_schema
- `description`: `ORDER BY` 多列方向必须与联合索引方向一致，否则触发 filesort。
- `rationale`: MySQL 5.x 不支持索引列混合升降序；8.x 虽支持需显式建降序索引。
- `anti_example`: 索引 `(shop_id ASC, created_time ASC)`，查询 `ORDER BY shop_id ASC, created_time DESC`。
- `correct_example`: 改方向，或为该查询建对应方向的索引。

#### D108 OR 跨非索引列

- `severity`: P1
- `category`: index
- `applies_to`: Mapper XML / Java DAO
- `concept`: `or_across_non_indexed_column`
- `confidence`: needs_schema
- `description`: `OR` 两侧字段若有任一无索引，整个查询走全表扫描；高频路径必须改 `UNION` 或拆查询。
- `rationale`: 优化器在 `OR` 上很难做选择性合并，常退化为全表。
- `anti_example`: `WHERE shop_id = #{shopId} OR creator = #{creator}`，`creator` 无索引。
- `correct_example`: 拆两次查询合并结果，或为 `creator` 补索引。

#### D109 写操作必须完整命中唯一键或明确受控索引

- `severity`: P0
- `category`: index
- `applies_to`: Mapper XML / Java DAO
- `concept`: `write_predicate_not_unique_key`
- `confidence`: needs_schema
- `description`: `UPDATE` / `DELETE` 高频写操作必须优先按主键、完整唯一键或明确受控的高选择性索引定位记录；联合唯一键中的中间列不得缺失，禁止只命中最左前缀后扩大写入范围。
- `rationale`: `WHERE` 命中最左前缀不等于命中唯一记录。漏掉联合唯一键中间列会让一次业务写入更新多条记录，并放大扫描行数与锁范围，导致索引失效、慢 SQL、误更新和死锁概率上升。
- `anti_example`:

```xml
<!-- 唯一键: uk_station_sku_channel_date (station_id, sku_id, channel_id, date) -->
<!-- 错误：漏掉 channel_id，虽然有 station_id、sku_id 最左前缀，但会更新该 SKU 所有渠道记录 -->
UPDATE sku_sale_daily
SET sale_num = sale_num + #{increaseNum}
WHERE station_id = #{stationId}
  AND sku_id = #{skuId}
  AND date = #{date}
```

- `correct_example`:

```xml
UPDATE sku_sale_daily
SET sale_num = sale_num + #{increaseNum}
WHERE station_id = #{stationId}
  AND sku_id = #{skuId}
  AND channel_id = #{channelId}
  AND date = #{date}
```

- `scan_note`: 对每条写 SQL 必须把 `WHERE` 条件与所有唯一键逐列对齐；发现 `(a,b,c,d)` 缺 `c` 但有 `d` 时，即使 D101 最左前缀满足，也应报告 D109。若只能证明"可能扩大范围"，但不能证明该业务场景下必然存在多行命中或数据放大，则标为 `🟡 疑似 D109`，并列出待确认的数据分布 / 业务前提。

### D2xx 死锁与并发

#### D201 事务内多表写入加锁顺序

- `severity`: P0
- `category`: concurrency
- `applies_to`: Java Service / Mapper XML
- `concept`: `tx_multi_table_write_lock_order`
- `confidence`: static
- `description`: 同一事务内对多张表执行写操作时，所有调用路径必须按**固定顺序**对表加锁；不同路径加锁顺序不一致会形成死锁。
- `rationale`: 死锁的本质是循环等待锁。MySQL InnoDB 不会自动重排，必须代码侧保证顺序一致。
- `anti_example`:

```java
// 路径 A：事务里先 insert orderMain 后 insert orderItem
@Transactional
public void createOrderA(...) {
    orderMainMapper.batchInsert(mainList);
    orderItemMapper.batchInsert(itemList);
}

// 路径 B：另一个入口先 insert orderItem 后 insert orderMain
@Transactional
public void createOrderB(...) {
    orderItemMapper.batchInsert(itemList);  // 顺序反了
    orderMainMapper.batchInsert(mainList);
}
```

- `correct_example`: 全项目统一"先 main 后 item"，或抽工具方法强制顺序。

#### D202 事务内对同表既批量插入又条件更新

- `severity`: P0
- `category`: concurrency
- `applies_to`: Java Service / Mapper XML
- `concept`: `tx_batch_insert_with_update_same_table`
- `confidence`: static
- `description`: 同一事务内对同一张表既执行批量 INSERT 又执行 UPDATE/DELETE，容易触发 next-key lock 与 gap lock 冲突导致死锁；必须拆事务或改单条处理。
- `rationale`: InnoDB 的 RR 隔离级别下，批量 INSERT 会持有 gap lock，UPDATE 又申请新锁范围，多并发下死锁概率极高。
- `anti_example`:

```java
@Transactional
public void process(...) {
    orderMapper.batchInsert(newOrders);          // 持 gap lock
    orderMapper.updateStatusByShop(shopId, ...); // 申请新范围锁 → 死锁
}
```

- `correct_example`: 拆为两个事务，或先 UPDATE 后 INSERT，或改单条 INSERT ON DUPLICATE KEY。

#### D203 事务范围内禁止远程调用 / 文件 IO

- `severity`: P0
- `category`: concurrency
- `applies_to`: Java Service
- `concept`: `tx_scope_too_wide`
- `confidence`: static
- `description`: `@Transactional` 方法内禁止包含 RPC、HTTP、Redis、文件 IO、消息发送；事务执行时间应控制在毫秒级。
- `rationale`: 事务持有行锁期间外部调用拉长事务时间，导致锁等待超时和死锁概率激增。
- `anti_example`:

```java
@Transactional
public void confirm(...) {
    orderMapper.updateStatus(...);
    remoteService.notify(...);  // ❌ RPC 在事务内
}
```

- `correct_example`: 事务方法只做 DB 操作，远程调用移到事务外或用消息队列异步化。

#### D204 SELECT FOR UPDATE 必须命中索引

- `severity`: P0
- `category`: concurrency
- `applies_to`: Mapper XML
- `concept`: `select_for_update_no_index`
- `confidence`: needs_schema
- `description`: `SELECT ... FOR UPDATE` 的 WHERE 必须命中索引，否则会从行锁退化为表锁。
- `rationale`: InnoDB 行锁基于索引；无索引时锁住所有扫描行，并发场景等同于表锁。
- `anti_example`: `SELECT id FROM order_main WHERE biz_no = #{bizNo} FOR UPDATE`，`biz_no` 无索引。
- `correct_example`: 为 `biz_no` 建唯一索引，或改用乐观锁（version 字段）。

#### D205 批量写入分批 + 单事务行数上限

- `severity`: P1
- `category`: concurrency
- `applies_to`: Mapper XML / Java DAO
- `concept`: `bulk_write_no_batching`
- `confidence`: static
- `description`: 单次批量 INSERT/UPDATE 影响行数应控制在 500~1000 以内；超出必须分批，且每批一个独立事务。
- `rationale`: 单事务持锁行数过多放大死锁影响范围，binlog 也容易超阈值。
- `anti_example`: `<foreach>` 拼接 1 万行 INSERT，单事务执行。
- `correct_example`: 每批 500 行，循环外控制事务边界。

#### D206 唯一键冲突走 ON DUPLICATE 或先查后插

- `severity`: P1
- `category`: concurrency
- `applies_to`: Mapper XML / Java Service
- `concept`: `unique_key_race`
- `confidence`: static
- `description`: 涉及唯一键的并发插入场景，必须使用 `INSERT ... ON DUPLICATE KEY UPDATE` 或"先查后插 + 唯一索引兜底"，禁止依赖业务层判重。
- `rationale`: "查不存在 → 插入"在并发下必然出现唯一键冲突异常，业务层判重不能替代 DB 约束。
- `anti_example`: 先 `selectByBizNo` 判空再 `insert`，两个线程同时通过判空导致主键冲突。
- `correct_example`: `INSERT ... ON DUPLICATE KEY UPDATE`，或捕获 `DuplicateKeyException` 并幂等处理。

#### D207 批量写入必须稳定排序

- `severity`: P0
- `category`: concurrency
- `applies_to`: Java Service / Mapper XML
- `concept`: `bulk_write_unstable_lock_order`
- `confidence`: static
- `description`: 同一事务内批量 `UPDATE` / `DELETE` / `INSERT ... ON DUPLICATE KEY UPDATE` 多行时，必须按主键或完整唯一键稳定排序后写入；禁止直接使用 `HashMap` / `HashSet` / 未排序 `Map` 的迭代顺序驱动 MyBatis `<foreach separator=";">` 多条写 SQL。
- `rationale`: 并发事务如果以不同顺序更新同一批行，会形成循环等待。InnoDB 不会替业务重排行锁申请顺序，批量写入的 ID 顺序必须由代码或 SQL 显式固定。
- `anti_example`:

```java
Map<Long, Integer> saleIncreaseMap = new HashMap<>();
// ... 不同消息填充顺序不同
transactionTemplate.execute(status -> {
    skuSaleDailyMapper.batchUpdateSkuSaleDailySaleNum(stationId, saleIncreaseMap, today);
    return null;
});
```

```xml
<foreach collection="saleIncreaseMap" index="skuId" item="increaseNum" separator=";">
  UPDATE sku_sale_daily
  SET sale_num = sale_num + #{increaseNum}
  WHERE station_id = #{stationId} AND sku_id = #{skuId} AND date = #{date}
</foreach>
```

- `correct_example`: Service 层先把 key 转为 `List` 并按 `(station_id, sku_id, channel_id, date)` 或主键升序排序，再传入 Mapper；或 Mapper SQL 使用 `ORDER BY` 锁定待更新行后按稳定顺序更新；同一事务内所有表也保持固定表顺序。
- `scan_note`: 看到 `foreach` 批量多语句写入、`CASE WHEN` 批量更新、`IN (...)` 驱动写操作时，必须回溯入参集合的构造方式。来源是无序集合或未见排序证据时，优先按 `🟡 疑似 D207` 报告潜在死锁风险；只有在同一事务、高频重叠写入集合、缺少稳定排序或重试兜底等证据同时成立时，才定为确认 P0。

### D3xx Mapper / SQL 通用规范

#### D301 写操作必须带 WHERE

- `severity`: P0
- `category`: convention
- `applies_to`: Mapper XML / Java DAO
- `concept`: `update_delete_no_where`
- `confidence`: static
- `description`: `UPDATE` / `DELETE` 必须带明确 WHERE；`<if>` 动态拼接 WHERE 时必须有兜底条件，禁止所有 `<if>` 都不成立导致无 WHERE。
- `rationale`: 防误更新 / 误删全表。
- `anti_example`:

```xml
<update id="updateStatus">
  UPDATE order_main SET status = #{status}
  <where>
    <if test="id != null"> AND id = #{id} </if>
  </where>
</update>
<!-- id 为 null 时退化为全表 UPDATE -->
```

- `correct_example`: Service 层强制校验 `id != null`，或 SQL 加 `WHERE 1=0` 兜底。

#### D302 禁止 SELECT *

- `severity`: P1
- `category`: convention
- `applies_to`: Mapper XML / Java DAO
- `concept`: `select_star`
- `confidence`: static
- `description`: 禁止 `SELECT *`，必须显式列出字段。
- `rationale`: 防字段变更导致映射 NPE、防多读字段拖慢网络 IO。
- `anti_example`: `SELECT * FROM order_main WHERE id = #{id}`
- `correct_example`: `SELECT id, shop_id, status, created_time FROM order_main WHERE id = #{id}`

#### D303 foreach 必须设置 separator/open/close

- `severity`: P1
- `category`: convention
- `applies_to`: Mapper XML
- `concept`: `mybatis_foreach_incomplete`
- `confidence`: static
- `description`: `<foreach>` 拼接 IN 列表或批量值时必须显式设置 `separator`、`open`、`close`；空集合需在 Service 层兜底。
- `rationale`: 缺 `separator` 会拼出语法错误；空集合传入会生成 `IN ()` 报错。
- `anti_example`:

```xml
<foreach collection="ids" item="id">
  #{id}
</foreach>
```

- `correct_example`:

```xml
<!-- Service 层确保 ids 非空 -->
<foreach collection="ids" item="id" separator="," open="(" close=")">
  #{id}
</foreach>
```

#### D304 IN 列表长度上限

- `severity`: P1
- `category`: convention
- `applies_to`: Mapper XML / Java Service
- `concept`: `in_list_too_large`
- `confidence`: static
- `description`: `IN` 列表元素数量不得超过 1000，超出必须分批查询并在 Service 层合并。
- `rationale`: 大 IN 列表既影响执行计划选择，也容易触发 SQL 长度上限。
- `anti_example`: Service 直接把 5000 个 ID 传入 `<foreach>`。
- `correct_example`: Service 层切片 `Lists.partition(ids, 500)` 后多次查询。

#### D305 ResultMap 列名严格匹配 DB

- `severity`: P1
- `category`: convention
- `applies_to`: Mapper XML
- `concept`: `resultmap_column_typo`
- `confidence`: needs_schema
- `description`: ResultMap 的 `column` 必须与 DB 实际列名完全一致（区分下划线），不一致会导致字段静默为 null。
- `rationale`: 字段映射错误编译期无感，运行期数据缺失。
- `anti_example`: DB 列 `shop_id`，ResultMap 写 `<result column="shopId" .../>`。
- `correct_example`: `<result column="shop_id" property="shopId"/>`。

#### D306 #{} vs ${} 使用规范

- `severity`: P0
- `category`: convention
- `applies_to`: Mapper XML
- `concept`: `sql_injection_risk_dollar`
- `confidence`: static
- `description`: 用户输入参数必须用 `#{}` 预编译；`${}` 仅允许用于表名、列名、排序方向等无法预编译的位置，且必须在 Service 层做白名单校验。
- `rationale`: `${}` 直接字符串拼接，等同于 SQL 注入。
- `anti_example`: `WHERE status = ${status}`
- `correct_example`: `WHERE status = #{status}`；动态表名 `${tableName}` 需配合白名单。

#### D307 Mapper 方法命名规范

- `severity`: P2
- `category`: convention
- `applies_to`: Mapper XML / Java DAO
- `concept`: `mapper_method_naming`
- `confidence`: static
- `description`: Mapper 方法名使用 `selectXxx` / `insertXxx` / `updateXxx` / `deleteXxx` / `countXxx` 前缀；批量操作加 `Batch` 后缀。
- `rationale`: 保持操作意图与命名一致，便于检索和审查。
- `anti_example`: `saveOrder`、`getList`、`removeById`
- `correct_example`: `insertOrder`、`selectList`、`deleteById`、`insertBatch`

#### D308 批量操作必须显式声明事务

- `severity`: P1
- `category`: convention
- `applies_to`: Java Service
- `concept`: `batch_no_explicit_tx`
- `confidence`: static
- `description`: 调用批量 `insertBatch` / `updateBatch` 的 Service 方法必须显式声明 `@Transactional`，或在调用链上层有事务包裹。
- `rationale`: 批量操作部分失败时若无事务，会留下不一致的脏数据。
- `anti_example`: Service 方法循环调用 `insertBatch` 但无 `@Transactional`。
- `correct_example`: `@Transactional(rollbackFor = Exception.class)` + 明确 rollback 异常类型。
