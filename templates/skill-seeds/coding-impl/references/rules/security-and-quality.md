# 安全与质量规范

> 本规则定义 OOP 通用规约、安全编码、单元测试和代码卫生基线。示例以 Java 为主，其他语言请按等价安全实践执行。

---

## 1. OOP / 通用规约

- **禁止魔法值**：所有硬编码字面量必须提取为命名常量。
- 包装类型比较使用 `equals()` 或等价安全比较方式。
- 金额计算使用高精度类型（如 `BigDecimal`），禁止浮点运算。
- 集合初始化时指定容量，避免扩容开销。
- 遍历集合时禁止直接调用 `remove()`，使用安全的迭代删除方式。
- 线程池必须显式创建，禁止使用可能导致 OOM 的无界队列快捷方法。
- `ThreadLocal` 使用后必须清理，防止内存泄漏。

## 2. 安全规约

### 2.1 注入防御

- SQL 查询必须参数化，禁止字符串拼接。
- 禁用外部实体注入风险接口（XXE）。
- 用户输入必须校验和转义。

### 2.2 数据泄露

- 日志脱敏规范见 `rules/coding/logging-and-comments.md §3`。
- 禁止硬编码密码/密钥，使用配置中心或环境变量。
- 文件权限最小化。

### 2.3 依赖安全

- 禁用已知高危漏洞的组件版本。
- 禁止使用 SNAPSHOT / RC / Beta 等测试版依赖上线。
- 反序列化必须白名单校验。

## 3. 单元测试

- 增量代码必须有对应单元测试。
- 圈复杂度超标时优先拆分方法。
- 测试覆盖核心逻辑、边界条件和异常路径。

## 4. 代码卫生

- IDE 警示必须清零。
- 圈复杂度超标时优先拆分方法，降低决策点数量。
- 重构是日常工作：小步前进 → 提取方法 → 重命名 → 移除重复 → 简化条件。
- 提交前运行静态检查工具。

## 5. 事务规约

> 以下规则同时适用于声明式事务（@Transactional）和编程式事务
>（TransactionTemplate、PlatformTransactionManager 手动管理）。

### 5.1 事务边界红线

- **禁止事务内循环重试**：事务范围内禁止 while/for 循环重试同一条记录。
  事务内的写操作对外不可见，重试读到的仍是旧版本，造成死循环或幻读。
  正确做法：重试逻辑放在事务外层，每次重试开启新事务。
  - 声明式：@Transactional 方法体内含重试循环
  - 编程式：transactionTemplate.execute() 回调内含重试循环，
    或 getTransaction() 与 commit() 之间含重试循环

- **禁止事务内发 MQ/RPC**：事务范围内禁止发消息或调用外部服务。
  事务回滚后消息已发出，造成数据不一致。
  正确做法：使用事务消息表，或 TransactionSynchronizationManager.afterCommit()。
  - 声明式：@Transactional 方法体内调用 send/publish/rpc
  - 编程式：transactionTemplate.execute() 回调内调用 send/publish/rpc

- **禁止大事务**：单个事务应保持短小精悍，避免长时间持有数据库连接。
  长事务会导致锁持有时间过长、undo log 膨胀，影响并发性能。
  原则：批量写入时单事务处理记录数应根据表结构和业务场景控制在合理范围内，
  避免一次性处理全量数据。具体阈值参考：单事务执行时间不宜超过 100ms。
  正确做法：分批提交，每批独立事务；或使用游标/offset 分页处理。
  - 声明式：@Transactional 方法内遍历大集合逐条写入
  - 编程式：单次 execute() 回调内遍历大集合，
    或 getTransaction() 后长时间不 commit

- **禁止事务内阻塞等待**：事务范围内禁止 Thread.sleep、Future.get、
  CountDownLatch.await 等阻塞操作。连接持有时间不可控，可耗尽连接池。
  正确做法：阻塞等待放在事务外部。

### 5.2 事务使用规范

- 事务粒度最小化：只在必须保证原子性的操作上开事务，只读查询不加事务。
- 明确传播行为：嵌套调用时显式标注 propagation，禁止依赖默认 REQUIRED
  隐式加入外层事务。
- 异常回滚：声明式确认 rollbackFor 覆盖业务异常（Spring 默认只回滚
  RuntimeException）；编程式在 catch 中必须调用 rollback 或 setRollbackOnly，
  禁止吞掉异常后继续 commit。
- 编程式事务必须保证 commit/rollback 配对：PlatformTransactionManager
  手动管理时，必须在 finally 中兜底 rollback，防止连接泄漏。
  优先使用 TransactionTemplate 而非手动 getTransaction/commit/rollback。
