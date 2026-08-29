# 日志解析模板

## 使用场景

当用户粘贴了错误日志或堆栈信息时，使用本模板结构化解析。

---

## 解析输出格式

### 1. 异常信息提取

| 字段 | 解析目标 | 示例 |
|------|---------|------|
| **异常类型** | 异常类名 | NullPointerException、IllegalArgumentException |
| **错误信息** | Exception 后的 message | Cannot invoke method on null |
| **错误码** | HTTP状态码/业务错误码 | 500、BIZ_001 |
| **Root Cause** | 最底层 Caused by | 最内层异常 |

### 2. 堆栈定位

```
直接异常点：{类}.{方法}({文件}:{行号})
  ↓
调用链路：
  1. {入口类}.{方法}({文件}:{行号})
  2. {中间层类}.{方法}({文件}:{行号})
  3. {直接异常点}({文件}:{行号})
```

### 3. 上下文信息

| 信息类型 | 提取方式 | 用途 |
|----------|----------|------|
| 触发条件 | 日志中的入参、请求参数 | 了解问题触发场景 |
| 时间线 | 日志时间戳序列 | 判断执行顺序和耗时 |
| 关联ID | TraceId/RequestId/OrderId | 串联上下游日志 |
| SQL语句 | 日志中的SQL打印 | 定位数据库问题 |

### 4. 问题特征

| 特征 | 判断依据 |
|------|----------|
| **必现** | 相同日志重复出现 |
| **偶发** | 只有个别日志 |
| **特定条件** | 特定参数/用户/时间触发 |

---

## 堆栈过滤规则

### 需要保留（项目代码）

过滤规则：只保留项目包名开头的行

```
# 项目包名前缀示例
com.jd.
com.company.
org.example.
```

### 需要过滤（框架层）

```
java.lang.*
java.util.*
java.io.*
sun.*
com.sun.*
org.springframework.*
org.apache.*
com.alibaba.*
io.netty.*
org.mybatis.*
com.mysql.*
```

---

## 输出模板

```markdown
## 日志解析摘要

**异常类型**：{异常类名}
**错误信息**：{message}
**Root Cause**：{最底层 Caused by 的异常}

**直接异常点**：{文件:行号} → {类}.{方法}

**调用链路**：
  1. {入口} → 2. {中间层} → 3. {异常点}

**触发条件**：{从日志中提取的入参/场景}
**问题特征**：{必现/偶发/特定条件}
**关联ID**：{TraceId/OrderId 等}
```

---

## 解析示例

### 输入

```
2025-06-08 10:30:15.123 ERROR [order-service] java.lang.NullPointerException: Cannot invoke method on null
    at com.jd.order.service.OrderService.createOrder(OrderService.java:128)
    at com.jd.order.controller.OrderController.submit(OrderController.java:45)
    at sun.reflect.NativeMethodAccessorImpl.invoke0(Native Method)
    at org.springframework.web.servlet.FrameworkServlet.service(FrameworkServlet.java:897)
```

### 输出

```markdown
## 日志解析摘要

**异常类型**：NullPointerException
**错误信息**：Cannot invoke method on null
**Root Cause**：NullPointerException

**直接异常点**：OrderService.java:128 → OrderService.createOrder

**调用链路**：
  1. OrderController.submit(OrderController.java:45)
  2. OrderService.createOrder(OrderService.java:128)

**触发条件**：{需结合业务上下文判断}
**问题特征**：{需结合日志重复情况判断}
**关联ID**：{需从日志中提取}
```

---

## 注意事项

1. **过滤框架层**：堆栈中框架层的行无需逐行列出，简要说明"已过滤"即可
2. **关注 Root Cause**：多层嵌套异常时，定位到最底层的真正根因
3. **提取关键信息**：不要逐字照搬堆栈，要提取关键位置
4. **结合业务上下文**：堆栈之外的信息（入参、业务ID）同样重要