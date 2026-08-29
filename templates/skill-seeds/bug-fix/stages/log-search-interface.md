# 日志检索脚本使用说明

## ⚠️ 严格约束

**禁止使用未定义参数**：只能使用本文档列出的参数，禁止猜测或发明参数。

**常见错误参数**：
- ❌ `--timeRange` - 不存在
- ❌ `--confirmed` - 不存在
- ❌ `--keyword`（log_context.sh） - 不接受

---

## get_system.sh - 获取 systemCode

根据 appCode 自动获取对应的 systemCode。

### API 调用规则

**一套接口，不区分环境**：
- appCode 固定使用 `-test` 后缀格式（如 `yzt-base-pay-gateway-test`）
- 返回值**统一去掉 `-test` 后缀**
- 由 `log_search.sh` 的 `get_system_name_with_env()` 函数根据环境决定是否添加

### 参数列表

| 参数 | 说明 | 如何获取 |
|-----|------|---------|
| `--appCode` | 应用编码 | 从 pom.xml 读取 + `-test` 后缀 |

### 调用示例

```bash
BUG_FIX="${BUG_FIX_DIR:-$HOME/.joycode/skills/bug-fix}"
[ -d "$BUG_FIX/scripts" ] || BUG_FIX=".joycode/skills/bug-fix"
[ -d "$BUG_FIX/scripts" ] || BUG_FIX="$HOME/.harness/skills/bug-fix"
[ -d "$BUG_FIX/scripts" ] || { echo "bug-fix scripts 未找到"; exit 1; }
# 无论什么环境,返回值都是不带 -test 的基础名
bash "$BUG_FIX/scripts/get_system.sh" --appCode "yzt-base-pay-gateway-test"
# 返回: systemCode: "yzt-hiboos"（统一去掉 -test）
```

### 与 log_search.sh 的配合

| 环境 | get_system.sh 返回 | log_search.sh 自动处理 | 最终值 |
|------|-------------------|----------------------|--------|
| test | `yzt-hiboos` | 加 `-test` | `yzt-hiboos-test` |
| pre | `yzt-hiboos` | 不加 | `yzt-hiboos` |
| prod | `yzt-hiboos` | 不加 | `yzt-hiboos` |

---

## log_search.sh - 日志检索

### 参数列表

| 参数 | 说明 | 如何获取 |
|-----|------|---------|
| `--keyword` | 搜索关键字 | 用户提供 |
| `--appName` | 应用名称 | 从 pom.xml 或 package.json 的 artifactId 读取 |
| `--systemName` | 系统名称 | 从 `get_system.sh` 获取（返回的 systemCode） |
| `--env` | 环境 | 询问用户，选项：test / pre / prod |
| `--pin` | 用户账号 | 优先从 `git config user.name` 获取，失败则询问 |
| `--erp` | 用户 erp | 默认使用 pin 值 |
| `--startTime` | 开始时间 | **AI 计算**：毫秒时间戳 |
| `--endTime` | 结束时间 | **AI 计算**：毫秒时间戳 |
| `--maxLines` | 最大返回行数 | 默认 100 |

### 时间参数计算

**AI 必须计算并传入时间戳**：
- 查今天的日志：startTime = 今天 00:00:00，endTime = 当前时间
- 查昨天的日志：startTime = 昨天 00:00:00，endTime = 昨天 23:59:59

### 调用示例

```bash
BUG_FIX="${BUG_FIX_DIR:-$HOME/.joycode/skills/bug-fix}"
[ -d "$BUG_FIX/scripts" ] || BUG_FIX=".joycode/skills/bug-fix"
[ -d "$BUG_FIX/scripts" ] || BUG_FIX="$HOME/.harness/skills/bug-fix"
[ -d "$BUG_FIX/scripts" ] || { echo "bug-fix scripts 未找到"; exit 1; }
# 查今天日志
bash "$BUG_FIX/scripts/log_search.sh \
  --keyword "1199580.1016625.17804542238294302" \
  --appName "yzt-base-pay-gateway" \
  --systemName "yzt-hiboos" \
  --env "test" \
  --pin "chuyaxin.5" \
  --startTime "1748880000000" \
  --endTime "1748921234567"

# 查昨天日志
bash "$BUG_FIX/scripts/log_search.sh \
  --keyword "1199580.1016625.17804542238294302" \
  --appName "yzt-base-pay-gateway" \
  --systemName "yzt-hiboos" \
  --env "test" \
  --pin "chuyaxin.5" \
  --startTime "1748793600000" \
  --endTime "1748880000000"
```

### 执行流程

1. **自动获取**：
   - appName：读取 pom.xml 或 package.json
   - pin：执行 `git config user.name`

2. **询问用户**（一次问完）：
   - systemName：系统名称
   - env：选择 test / pre / prod
   - 时间范围：今天还是昨天

3. **AI 计算**：
   - startTime 和 endTime 的毫秒时间戳

4. **调用脚本**：一次性传入所有参数

### 返回结果

成功时返回 results 数组，包含：
- `file`：日志文件路径（调用 log_context.sh 时需要）
- `logs`：日志行数组，每行包含 lineNum 和 content

---

## log_context.sh - 获取日志上下文

当日志被截断（如以"系统异常: "结尾但没有堆栈）时，调用此脚本获取完整上下文。

### 参数列表

| 参数 | 说明 | 如何获取 |
|-----|------|---------|
| `--file` | 日志文件路径 | 从 log_search.sh 返回结果的 file 字段获取 |
| `--baseLineNum` | 基准行号 | 从 log_search.sh 返回结果的 lineNum 字段获取 |
| `--env` | 环境 | 与 log_search.sh 相同 |
| `--pin` | 用户账号 | 与 log_search.sh 相同 |
| `--erp` | 用户 erp | 默认使用 pin 值 |
| `--contextNum` | 上下文行数 | 默认 100 |

### 调用示例

```bash
BUG_FIX="${BUG_FIX_DIR:-$HOME/.joycode/skills/bug-fix}"
[ -d "$BUG_FIX/scripts" ] || BUG_FIX=".joycode/skills/bug-fix"
[ -d "$BUG_FIX/scripts" ] || BUG_FIX="$HOME/.harness/skills/bug-fix"
[ -d "$BUG_FIX/scripts" ] || { echo "bug-fix scripts 未找到"; exit 1; }
# 从 log_search.sh 返回结果中提取 file 和 lineNum
bash "$BUG_FIX/scripts/log_context.sh \
  --file "/mnt/cfs/log/archive/xxx.log.gz" \
  --baseLineNum 2808 \
  --env "test" \
  --pin "chuyaxin.5" \
  --contextNum 100
```

**注意**：log_context.sh 不接受 `--keyword`、`--appName`、`--systemName` 参数。

---

## 配置文件

路径：`.harness/wiki/bug-fix/config.json`

首次使用或参数变更时，保存用户信息供后续使用：

```json
{
  "basic": {
    "app_name": "yzt-base-pay-gateway",
    "system_name": "yzt-hiboos"
  },
  "user": {
    "pin": "chuyaxin.5",
    "erp": "chuyaxin.5"
  },
  "env": {
    "value": "test"
  },
  "preference": {
    "default_time_range": "today",
    "default_max_lines": 100,
    "auto_get_context": true
  }
}