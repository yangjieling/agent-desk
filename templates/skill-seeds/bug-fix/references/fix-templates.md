# 修复模板库

---

## 一、逻辑错误修复模板

### 1. 条件判断错误

```yaml
问题特征:
  - if/else 分支判断条件写反或遗漏
  
修复模板:
  name: 条件判断修正
  steps:
    - 定位错误的条件判断语句
    - 分析期望的判断逻辑
    - 修正条件表达式
    - 补充遗漏的分支
    
  before: |
    if (status == 1) {
        // 处理成功
    }
    
  after: |
    if (status == 0) {  // 修正：0 表示成功
        // 处理成功
    } else if (status == 1) {
        // 处理失败
    } else {
        // 处理其他情况
    }
    
  test_points:
    - 验证所有分支都能正确进入
    - 验证边界条件
```

### 2. 循环逻辑错误

```yaml
问题特征:
  - 循环条件错误、死循环、循环次数不对
  
修复模板:
  name: 循环逻辑修正
  steps:
    - 定位循环逻辑错误
    - 确定正确的循环条件
    - 确保循环能正确退出
    
  before: |
    for (int i = 0; i < list.size(); i++) {
        // 处理逻辑
        // 缺少退出条件，可能死循环
    }
    
  after: |
    for (int i = 0; i < list.size(); i++) {
        if (/* 终止条件 */) {
            break;  // 添加退出条件
        }
        // 处理逻辑
    }
    
  test_points:
    - 验证循环能正确退出
    - 验证循环次数
```

### 3. 边界处理错误

```yaml
问题特征:
  - 数组越界、空值未处理
  
修复模板:
  name: 边界条件处理
  steps:
    - 识别边界条件
    - 增加边界判断
    - 增加默认值或异常处理
    
  before: |
    String name = user.getName().toString();
    
  after: |
    String name = user.getName() != null 
        ? user.getName().toString() 
        : "默认名称";
        
  test_points:
    - 验证空值处理
    - 验证边界值处理
```

---

## 二、数据错误修复模板

### 1. 空值处理

```yaml
问题特征:
  - NullPointerException、空指针访问
  
修复模板:
  name: 空值判断
  steps:
    - 识别可能出现空值的位置
    - 增加空值判断
    - 提供默认值或抛出明确异常
    
  before: |
    return user.getOrder().getId();
    
  after: |
    if (user == null || user.getOrder() == null) {
        return null;  // 或抛出异常
    }
    return user.getOrder().getId();
    
  test_points:
    - 验证空对象处理
    - 验证链式调用中的空值
```

### 2. 数据格式校验

```yaml
问题特征:
  - 类型转换失败、格式解析错误
  
修复模板:
  name: 数据格式校验
  steps:
    - 识别数据格式要求
    - 增加格式校验
    - 处理格式错误情况
    
  before: |
    int age = Integer.parseInt(ageStr);
    
  after: |
    int age;
    try {
        age = Integer.parseInt(ageStr);
    } catch (NumberFormatException e) {
        log.error("年龄格式错误: {}", ageStr);
        throw new BusinessException("年龄格式错误");
    }
    
  test_points:
    - 验证正常格式
    - 验证异常格式处理
```

### 3. 数据一致性修复

```yaml
问题特征:
  - 并发更新、事务问题
  
修复模板:
  name: 数据一致性保障
  steps:
    - 识别事务边界
    - 增加事务控制
    - 增加并发控制
    
  before: |
    public void updateOrder(Order order) {
        orderDao.update(order);
        inventoryDao.decrease(order.getProductId(), order.getCount());
    }
    
  after: |
    @Transactional(rollbackFor = Exception.class)
    public void updateOrder(Order order) {
        // 增加乐观锁
        int affected = orderDao.updateWithVersion(order);
        if (affected == 0) {
            throw new ConcurrentModificationException("订单已被其他用户修改");
        }
        inventoryDao.decrease(order.getProductId(), order.getCount());
    }
    
  test_points:
    - 验证事务回滚
    - 验证并发场景
```

---

## 三、配置错误修复模板

### 1. 配置缺失处理

```yaml
问题特征:
  - 必要配置项未配置
  
修复模板:
  name: 配置缺失处理
  steps:
    - 识别缺失的配置项
    - 增加配置默认值
    - 增加配置校验
    
  before: |
    String url = config.getUrl();
    
  after: |
    String url = config.getUrl();
    if (StringUtils.isEmpty(url)) {
        url = DEFAULT_URL;  // 提供默认值
        log.warn("URL未配置，使用默认值: {}", url);
    }
    
  test_points:
    - 验证配置缺失时的默认值
    - 验证配置存在时的正常处理
```

### 2. 环境配置不一致

```yaml
问题特征:
  - 测试环境正常，生产环境异常
  
修复模板:
  name: 环境配置统一
  steps:
    - 对比各环境配置
    - 统一配置项
    - 增加配置校验机制
    
  before: |
    // 硬编码的配置
    String apiUrl = "http://test-api.example.com";
    
  after: |
    // 从配置中心读取
    @Value("${api.url}")
    private String apiUrl;
    
  test_points:
    - 验证各环境配置正确
    - 验证配置热更新
```

---

## 四、并发问题修复模板

### 1. 线程安全问题

```yaml
问题特征:
  - 共享变量未加锁
  
修复模板:
  name: 线程安全修复
  steps:
    - 识别共享变量
    - 增加同步机制
    - 或使用线程安全的数据结构
    
  before: |
    private int count = 0;
    
    public void increment() {
        count++;
    }
    
  after: |
    private AtomicInteger count = new AtomicInteger(0);
    
    public void increment() {
        count.incrementAndGet();
    }
    
  test_points:
    - 验证并发场景下的正确性
    - 验证性能影响
```

### 2. 死锁修复

```yaml
问题特征:
  - 循环等待导致系统挂起
  
修复模板:
  name: 死锁修复
  steps:
    - 分析锁的获取顺序
    - 统一锁顺序
    - 增加超时机制
    
  before: |
    public void transfer(Account from, Account to, int amount) {
        synchronized (from) {
            synchronized (to) {
                from.debit(amount);
                to.credit(amount);
            }
        }
    }
    
  after: |
    public void transfer(Account from, Account to, int amount) {
        // 统一锁顺序：按 ID 排序
        Account first = from.getId() < to.getId() ? from : to;
        Account second = from.getId() < to.getId() ? to : from;
        
        synchronized (first) {
            synchronized (second) {
                from.debit(amount);
                to.credit(amount);
            }
        }
    }
    
  test_points:
    - 验证无死锁
    - 验证转账正确性
```

---

## 五、性能问题修复模板

### 1. 查询优化

```yaml
问题特征:
  - SQL 未优化、缺少索引
  
修复模板:
  name: 查询性能优化
  steps:
    - 分析慢查询
    - 增加索引
    - 优化 SQL
    
  before: |
    SELECT * FROM orders WHERE user_id = ?
    
  after: |
    -- 添加索引
    CREATE INDEX idx_user_id ON orders(user_id);
    
    -- 优化查询
    SELECT id, order_no, amount, status 
    FROM orders 
    WHERE user_id = ?
    ORDER BY create_time DESC
    LIMIT 100;
    
  test_points:
    - 验证查询性能
    - 验证查询结果正确
```

### 2. 缓存优化

```yaml
问题特征:
  - 缓存穿透、缓存雪崩
  
修复模板:
  name: 缓存优化
  steps:
    - 增加缓存
    - 处理缓存穿透
    - 处理缓存雪崩
    
  before: |
    public User getUser(Long id) {
        return userDao.findById(id);
    }
    
  after: |
    public User getUser(Long id) {
        String key = "user:" + id;
        User user = cache.get(key);
        if (user != null) {
            return user;
        }
        
        user = userDao.findById(id);
        if (user == null) {
            // 防止缓存穿透：缓存空值
            cache.set(key, new User(), 60);
            return null;
        }
        
        // 防止缓存雪崩：随机过期时间
        int expire = 3600 + new Random().nextInt(600);
        cache.set(key, user, expire);
        return user;
    }
    
  test_points:
    - 验证缓存命中
    - 验证缓存穿透防护
    - 验证缓存雪崩防护
```

---

## 六、依赖问题修复模板

### 1. 外部服务异常处理

```yaml
问题特征:
  - 外部接口超时、返回错误
  
修复模板:
  name: 依赖服务容错
  steps:
    - 增加超时设置
    - 增加重试机制
    - 增加熔断和降级
    
  before: |
    public Result callExternalService(Request request) {
        return externalService.call(request);
    }
    
  after: |
    @Retryable(value = {TimeoutException.class}, maxAttempts = 3)
    @CircuitBreaker(fallbackMethod = "fallback")
    @Timeout(value = 5, unit = TimeUnit.SECONDS)
    public Result callExternalService(Request request) {
        return externalService.call(request);
    }
    
    public Result fallback(Request request) {
        log.warn("外部服务不可用，使用降级方案");
        return Result.defaultResult();
    }
    
  test_points:
    - 验证超时处理
    - 验证重试机制
    - 验证降级方案
```

---

## 七、使用说明

### 模板选择原则

1. **根据问题类型选择模板**
   - 逻辑错误 → 逻辑错误修复模板
   - 数据错误 → 数据错误修复模板
   - 以此类推

2. **模板组合使用**
   - 一个问题可能涉及多个模板
   - 按优先级依次处理

3. **模板定制化**
   - 模板是参考，需根据实际情况调整
   - 保持修复原则，调整具体实现

### 注意事项

- 修复前确保理解问题根因
- 修复后必须验证
- 考虑修复的副作用
- 每次只修复一个问题的核心部分