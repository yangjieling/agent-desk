# 海博后厨智能体(yzt-kitchen-agent) 代码审查规范

## 一、Web层（Controller）审查规范

### 1.1 接口定义规范
- [ ] Controller类必须使用 `@RestController` + `@RequestMapping` 注解组合
- [ ] 每个接口方法必须添加 `@Logging` 注解，确保请求日志可追溯
- [ ] 接口必须返回统一响应结构 `ServiceResponse<T>`，禁止直接返回裸对象
- [ ] POST接口使用 `@PostMapping`，GET接口使用 `@GetMapping`，禁止混用
- [ ] 接口路径命名采用小写+斜杠分隔（如 `/coding/webhook/callback`），禁止使用驼峰

### 1.2 参数校验规范
- [ ] 入参DTO必须定义独立的请求类，复杂参数禁止直接使用 `Map<String, Object>` 接收
- [ ] 关键参数必须在Controller层做非空校验，不合法时直接返回错误响应
- [ ] 分页参数必须设置合理默认值（如 page=1, perPage=20）
- [ ] 禁止在Controller层进行强制类型转换（如 `(Integer) param.get("xxx")`），应由DTO框架自动绑定

### 1.3 职责边界规范
- [ ] Controller层只做参数接收、参数校验、DTO↔BO转换和结果返回
- [ ] 禁止在Controller层编写业务逻辑（如条件判断、数据计算）
- [ ] 跨层调用只能调用Domain层或App层服务，禁止直接调用Infrastructure层Gateway
- [ ] Converter转换器必须放在Web层的 `converter` 包内，且为纯静态工具类

### 1.4 异常处理规范
- [ ] Controller层禁止捕获异常（由全局异常处理器统一处理）
- [ ] 对外接口禁止暴露内部堆栈信息

---

## 二、应用层（App/Client）审查规范

### 2.1 服务定义规范
- [ ] JSF对外服务接口必须定义在 `client` 模块中
- [ ] 接口实现类必须在 `app` 模块中，且使用 `@BootService` 注解声明
- [ ] 接口方法的入参和返回值必须使用DTO对象，禁止使用领域对象（BO/DO）
- [ ] 对外DTO必须实现 `Serializable` 接口

### 2.2 接口设计规范
- [ ] 每个对外方法必须添加 `@Logging` 注解
- [ ] 返回结果统一使用 `ServiceResponse<T>` 包装
- [ ] 方法必须做入参防御校验（null检查、必填字段检查），不符合时返回空响应而非抛异常
- [ ] 禁止在App层直接操作缓存、数据库等基础设施，应通过Domain层间接调用

### 2.3 转换规范
- [ ] App层负责DTO→BO和BO→DTO的转换
- [ ] 禁止在App层使用 `BeanUtils.copyProperties` 进行转换（字段遗漏不易发现），应使用显式赋值或MapStruct
- [ ] 批量转换必须处理集合为空的场景

---

## 三、领域层（Domain）审查规范

### 3.1 领域服务规范
- [ ] 领域服务接口定义在 `domain` 包根目录，实现类放在 `domain.impl` 包中
- [ ] 领域服务命名必须以 `DomainService` 结尾（如 `CodeReviewDomainService`）
- [ ] 领域服务只关注业务逻辑编排，禁止涉及技术细节（如HTTP调用、JSON解析细节）
- [ ] 领域对象（BO）定义在 `domain.bo` 包中，必须使用 `@Data` 注解并添加字段注释

### 3.2 责任链处理器规范
- [ ] 处理器必须实现 `CodingHandlerProcess` 接口
- [ ] 生效的处理器必须添加 `@Component` 和 `@Order` 注解，明确执行顺序
- [ ] 暂不启用的处理器必须注释掉 `@Component`，并添加注释说明原因
- [ ] 处理器内部必须先做参数校验，不合法时设置 `paramBO.setFilter(Boolean.TRUE)` 并提前return
- [ ] 处理器中捕获异常时必须记录ERROR级别日志，禁止吞掉异常不处理
- [ ] 处理器禁止相互依赖或直接调用其他处理器

### 3.3 Plan-And-Execute模式规范
- [ ] 执行计划（AgentPlanBO）必须包含 stepNumber、action、tool、goal 四个关键字段
- [ ] 工具类型必须在 `AgentToolsEnum` 枚举中注册，禁止使用硬编码字符串
- [ ] 每个工具执行方法必须返回统一的 `AgentExecuteResultBO`，包含success、status、msg
- [ ] 工作流轮询必须设置最大超时时间，禁止无限轮询（建议最大60秒）
- [ ] 轮询间隔不得小于500ms，防止CPU空转

### 3.4 异常处理规范
- [ ] 领域层异常统一抛出 `YZTException`，携带明确的业务错误信息
- [ ] 异常信息必须包含上下文（如操作名称、关键参数），便于问题定位
- [ ] 禁止使用 `e.printStackTrace()`，必须通过DongLogger记录
- [ ] 非关键步骤失败不应中断整体流程（如单文件获取失败不影响批量处理）

---

## 四、基础设施层（Infrastructure）审查规范

### 4.1 网关接口规范
- [ ] 网关接口定义在 `infra-api` 模块，实现在 `infra-impl` 模块
- [ ] 网关命名必须以 `Gateway` 结尾（如 `KitchenCodingGateway`）
- [ ] 网关接口方法的入参和返回值必须使用DO对象或基础类型，禁止使用BO
- [ ] 数据对象（DO）定义在 `infra.dataobj` 包中

### 4.2 外部服务调用规范
- [ ] 所有HTTP调用必须设置连接超时和读取超时（建议连接超时30s，读取超时60s）
- [ ] HTTP客户端（HttpClient/RestTemplate）禁止每次请求新建实例，应复用或使用连接池
- [ ] 外部调用必须记录入参和出参日志（使用DongLogger的lambda格式避免性能损耗）
- [ ] 日志格式统一为：`"模块|方法|操作|入参/出参|[{}]"`
- [ ] 调用失败必须抛出 `YZTException` 并携带状态码/错误信息
- [ ] 禁止在网关实现中硬编码敏感信息（Token、Secret等），应通过配置中心管理

### 4.3 缓存操作规范
- [ ] 缓存Key必须使用统一前缀（`kitchen:agent:`），并按业务维度添加二级前缀
- [ ] 所有缓存操作必须设置过期时间，禁止永久存储
- [ ] 缓存取值后必须做null检查，不能假设缓存一定存在
- [ ] 缓存序列化统一使用JSON格式（`JSON.toJSONString` / `JSON.parseObject`）

### 4.4 JSF远程调用规范
- [ ] JSF引用必须通过 `@BootReference` 注解配置，明确alias、超时、重试次数
- [ ] 超时时间根据接口特性设置（普通接口6s，数据查询接口10s）
- [ ] 重试次数默认为0（大部分操作不幂等，重试可能造成数据不一致）
- [ ] 调用结果必须做null检查和状态码校验，不能假设response一定成功

### 4.5 Converter转换规范
- [ ] 基础设施层Converter放在 `infra.converter` 包中
- [ ] Converter为纯静态工具类，禁止注入Spring Bean
- [ ] 转换方法命名：`buildXxx`（构建新对象）、`convertXxx`（类型转换）
- [ ] 转换时禁止使用反射拷贝（`BeanUtils.copyProperties`），必须逐字段显式赋值

---

## 五、公共模块（Common）审查规范

### 5.1 枚举规范
- [ ] 枚举类必须包含 `code`（编码）和 `desc`（描述）两个字段
- [ ] 枚举必须提供静态方法 `getByCode(String code)` 用于反向查找
- [ ] 枚举值命名使用全大写+下划线（如 `GET_PRD`、`CODE_REVIEW`）
- [ ] 枚举类禁止添加可变状态字段

### 5.2 常量规范
- [ ] 常量类使用 `final class` + `private构造方法` 防止实例化
- [ ] 常量命名全大写+下划线，添加明确注释
- [ ] 同一业务域的常量集中定义在一个常量类中

### 5.3 异常规范
- [ ] 自定义业务异常统一继承 `YZTException`
- [ ] 异常类必须携带错误码和错误信息
- [ ] 禁止使用 `RuntimeException` 等通用异常

### 5.4 工具类规范
- [ ] 工具类使用 `final class` + `private构造方法`
- [ ] 方法全部为 `public static`
- [ ] 工具类禁止注入Spring Bean，如需使用Spring功能应定义为 `@Component`

---

## 六、通用编码规范

### 6.1 日志规范
- [ ] 统一使用 `DongLogger`，禁止使用 `System.out.println` 或 `slf4j`
- [ ] 日志级别使用规范：
  - `ERROR`：系统异常、外部调用失败
  - `WARN`：业务校验不通过、可恢复异常
  - `INFO`：关键业务节点、外部调用入参出参
- [ ] 日志参数使用lambda表达式延迟求值：`log.info("msg: [{}]", () -> JSON.toJSONString(obj))`
- [ ] 禁止在循环体内打印日志（防止日志风暴）

### 6.2 注释规范
- [ ] 类必须添加类注释（描述、作者、日期）
- [ ] 公开方法必须添加Javadoc注释（描述、参数、返回值）
- [ ] 复杂逻辑必须添加步骤注释（如 `// 1. 校验参数`、`// 2. 处理任务`）
- [ ] 禁止保留无意义的TODO注释或过时的注释代码

### 6.3 命名规范
- [ ] 包名：全小写，按模块功能划分（如 `domain.process.impl`）
- [ ] 类名：大驼峰，Service/Gateway/Controller/BO/DO/DTO/Enum明确后缀
- [ ] 方法名：小驼峰，动词开头（如 `handlePushEvent`、`buildInvokeParam`）
- [ ] 常量：全大写+下划线
- [ ] 布尔变量/方法：使用is/has/can前缀

### 6.4 安全规范
- [ ] 禁止在代码中硬编码Token、Secret、密码等敏感信息
- [ ] 敏感配置必须通过DUCC配置中心或环境变量管理
- [ ] 对外接口入参必须做防注入处理
- [ ] 日志中禁止打印完整的Token、密码等敏感字段

### 6.5 性能规范
- [ ] 禁止在循环中进行远程调用（RPC/HTTP/Redis），应批量处理
- [ ] 大对象JSON序列化日志必须使用lambda延迟求值
- [ ] HTTP连接必须在finally中正确释放资源
- [ ] 消息推送内容超过2000字符必须截断处理
- [ ] 轮询逻辑必须设置最大重试次数或超时时间，防止死循环

### 6.6 分支管理规范
- [ ] master分支：生产环境分支，名称固定为 `master`
- [ ] pre分支：预发环境分支，名称固定为 `pre`
- [ ] test-eone分支：测试环境分支，名称固定为 `test-eone`
- [ ] 功能分支：命名格式为 `yyyyMMdd-功能描述`（如 `20260512-add-code-review`）
- [ ] 其他命名方式均视为不规范