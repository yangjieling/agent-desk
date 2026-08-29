# 失败汇报模板

> 一旦有用例不通过，继续跑完剩余用例（不 early-return），最终统一汇报。**表头四列固定**：测试内容 / 预期 / 结果 / 问题根因。

## 一、汇报格式

```markdown
## 结果：❌ 测试不通过 <N>/<total> 条

### 失败清单

| 测试内容 | 预期 | 结果 | 问题根因 |
|----------|------|------|----------|
| <用例简述> | <关键预期，可含数据 diff> | <实际响应 + 关键 diff> | <一句话根因结论，附涉及类/表/字段> |
| ... | ... | ... | ... |

### 根因摘要

- **共性问题**：<是否多个用例根因相同，如都是缓存缺 id>
- **风险级别**：<高/中/低>
- **影响面**：<线上是否已有相同链路，是否需要立即回滚>

### 处置选择

请回复：
- **开启修复** → 立即启动 `bug-fix` skill，本次根因结论作为初始输入
- **我自己解决** → 归档本次方案 md，结束会话
```

## 二、字段填写要求

### 2.1 测试内容
- 引用测试方案 § 6 的用例编号 + 简述，例：`#3 报损出库 opType=35`
- 不需要复制完整参数，链接到用例矩阵即可

### 2.2 预期
- 至少写清楚**关键状态变化**：DB 表哪个字段应该 +N/-N，响应 code=0，MQ 应发出什么消息
- 数据 diff 格式：`stock -5、stock_lock -5、storage 归 0`

### 2.3 结果
- **响应**：JSF 返回 code / msg / 耗时
- **实际 diff**：DB 前后对比结果（引用 § 7 差值表）
- **traceId**：便于后续追查
- 例：`code=291072 "储位库存更新失败"，stock 未变化，storage_stock_lock 未新增，traceId=abc123`

### 2.4 问题根因
- **一句话结论**：定位到「类 + 方法 + 变量/表/字段」层面
- 例：`storage_stock_lock 缓存明细缺 id → updateByPrimaryKeySelective 命中 id=null → 更新 0 行 → 上游抛 291072`
- 太长的根因链放到 § 8 详细说明；表格里只保留一句

## 三、汇报示例

```markdown
## 结果：❌ 测试不通过 2/3 条

### 失败清单

| 测试内容 | 预期 | 结果 | 问题根因 |
|----------|------|------|----------|
| #2 报损出库 opType=35 | stock -5、stock_lock -5、storage 归 0、生成流水 | code=291072「储位库存更新失败」，事务回滚，所有表无变化，traceId=abc123 | `storage_stock_lock` 缓存 harvest 阶段未回填自增 id，`updateByPrimaryKeySelective` 命中 `id=null` → 0 行 → 上游抛 291072 |
| #3 报损取消 opType=34 | 释放 stock_transit_lock 明细行，恢复 stock_num | 响应 code=0 但明细未释放，stock_num 未回补，traceId=def456 | 同 #2 类型：`stock_transit_lock` 明细缓存缺 id，`delete` 行 0 但代码未校验 rows |

### 根因摘要

- **共性问题**：都是「明细缓存对象未回填自增 id」导致后续 update/delete 落空
- **风险级别**：🔴 高
- **影响面**：全部报损/取消链路都会受影响；线上如已有相似流量需评估修复优先级

### 处置选择

请回复：
- **开启修复** → 启动 bug-fix skill
- **我自己解决** → 归档
```

## 四、异常场景

### 4.1 全部失败但根因相同
- 表格里前 2 条完整填，其他行用「同 #1，参数不同」缩写
- 根因摘要重点说清楚

### 4.2 有的用例执行不了（前置数据缺失等）
- 归到失败清单，用「执行阻塞」代替「结果」
- 根因列写清缺什么、需要补什么

### 4.3 数据核对失败但 JSF code=0
- 明确写「响应成功 / 数据未落」，避免用户误以为通过
- 根因通常涉及事务回滚、异步、缓存对齐等，重点提示

### 4.4 环境问题（token 过期、网络不通）
- **不算失败**，先自愈：token 过期 → jd-token-tool 静默刷新；网络不通 → 提示切网络
- 自愈失败才升级为闸门问题

## 五、切 bug-fix 的交接内容

用户选择「开启修复」时，向 bug-fix skill 传递以下上下文：

```yaml
handoff_to: bug-fix
context:
  test_plan_md: <path/to/test-plan.md>
  failed_cases:
    - case_id: "#3"
      symptom: "code=291072 事务回滚"
      trace_id: "abc123"
      root_cause: "storage_stock_lock 缓存缺 id"
      涉及文件:
        - StorageStockLockService.java
        - StorageStockLockMapper.xml
      修复方向:
        - "insert 端 useGeneratedKeys 回填 id"
        - "update 端 id=null 时降级按业务唯一键"
        - "明细 CRUD 增加 rows==0 告警"
runId: "08181530"
  jsf_host: "6.244.233.39:22012"
```

bug-fix 就可以直接进入「根因确认 → 复现验证 → 修复」阶段，不需要再重跑改动分析。