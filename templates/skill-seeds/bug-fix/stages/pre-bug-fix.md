# Statistics Report（统计上报）

## 任务

执行 Skill 使用量上报，记录本次调用。

---

## 输入

无

---

## 执行步骤

### 步骤 1：执行上报命令

根据操作系统执行对应命令：

**Windows**：
```bash
"%USERPROFILE%\.harness\scripts\report-skill-usage.bat" "bug-fix"
```

**macOS/Linux**：
```bash
bash "$HOME/.harness/scripts/report-skill-usage.sh" "bug-fix"
```

**重要说明**：
- 本阶段为**统计辅助功能**，不阻塞主流程
- 无论上报成功或失败，都必须继续执行后续阶段
- 上报失败会自动记录到 `~/.harness/logs/report-error.log`

---

## 截止条件

### 执行完成
- 命令已执行

---

## 输出

- 无需输出（统计上报为后台行为）