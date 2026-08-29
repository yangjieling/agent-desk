# Critical Code Quality Checklist

Step 4.6 「关键代码质量」扫描的纳入与不纳入边界。

核心原则：**只看影响功能正确性的硬伤**。命名 / 抽象 / 重复 / 风格等交给 `/review`。

---

## 一、纳入范围（必扫）

### 1. NPE 风险（主路径）

- 未做 null 检查就解引用：`obj.field`、`list.get(0)`、`map.get(k).xxx()`
- `Optional` 使用 `.get()` 但未先 `isPresent()`
- `String#trim/equals/length` 等对外部传入字段直接调用
- RPC / DB 返回值未判空就用

**重点**：仅当问题在主路径（请求处理 / 业务编排 / 接口对外）才报。深层 utils 内部辅助方法不报。

### 2. 边界条件

- 数组/集合越界：`arr[i]`、`list.get(i)` 未检查 `i` 范围
- 数值溢出：`int * int` 未转 `long`
- 空集合迭代不算 bug，但**空集合上提取首元素**算
- 分页参数：`page`、`pageSize` 负值 / 0 未拦截
- 时间边界：跨日 / 时区 / 闰年未处理

### 3. 并发安全

- 共享可变状态（`HashMap`、`SimpleDateFormat`、非线程安全 SDK）跨线程使用
- 单例中持有 `final` 之外的可变字段且被多线程读写
- 非原子复合操作（如"先查后写"模式无锁/CAS）
- 锁粒度过大或锁错对象（lock 在局部变量上）

### 4. 异常吞掉 / 误处理

- `catch (Exception e) {}` 空捕获
- `catch` 后只 `printStackTrace` 不抛不记
- 把业务异常转成 `null` 返回，调用方无法感知
- `try-with-resources` 应使用却没用，资源泄漏

### 5. 安全硬伤

- SQL 注入：字符串拼接 SQL（含 `${...}` 拼接 SQL 模板）
- 命令注入：`Runtime.exec(userInput)`
- 路径穿越：未校验 `..` 的文件路径拼接
- 鉴权 / 权限校验缺失：对外接口未走鉴权链
- 敏感信息硬编码：Token / Secret / 密钥
- 日志泄漏：完整密码 / Token 出现在 INFO/ERROR 日志

### 6. 数据丢失 / 一致性

- 分布式事务缺失但有跨服务写
- "先发消息再落库"等顺序错误
- 批量操作部分失败未补偿、未告警

---

## 二、不纳入范围（交给 `/review`）

明确 **不要报**：

- 命名不规范（变量名 `a`、`tmp` 等，除非影响理解关键路径）
- 代码重复（DRY 违反）
- 抽象层级（应当抽方法 / 应当合并类）
- 复杂度（圈复杂度 / 嵌套深度）
- 注释不足
- 日志措辞 / 拼写
- 代码格式 / import 顺序
- 单元测试覆盖率
- 性能微优化（无明显瓶颈情况下）

如果某项被团队规范明确禁止 → 走 4.3 团队规范，不要在这里重复报。

如果某项已被 [`database-conventions.md`](database-conventions.md) 的 D 系列规则覆盖（如 `SELECT *`、`UPDATE/DELETE` 无 WHERE、LIKE 前置通配、索引命中问题），优先走数据库规范维度，不要在关键代码质量中重复报。SQL 注入属于安全硬伤，若同一位置同时存在 `SELECT *` 和 SQL 注入，应保留两条不同语义问题；最终由 `SKILL.md` Step 4.7 按 `(concept, target, fix_action)` 去重。

---

## 三、严重级标注

每条问题需标注严重级，用于报告分组与风险等级计算：

| 级别 | 含义 | 示例 |
|------|------|------|
| 🔴 高 | 触发即引发线上故障 / 数据丢失 / 鉴权绕过 | NPE 主路径、SQL 注入、并发覆盖写、鉴权缺失 |
| 🟡 中 | 在特定输入下出错，但不一定线上必现 | 边界条件、异常吞掉、内部并发风险 |
| 🟢 低 | 几乎不在本扫描范围 | （不报） |

风险等级计算见 [`review-rubric.md`](review-rubric.md) §三。

---

## 四、证据要求

同 [`review-rubric.md`](review-rubric.md) §四：必须附 `file:line` + ≤5 行片段。
