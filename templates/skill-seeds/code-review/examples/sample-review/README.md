# Sample Review

虚构的小型示例，便于直观感受工作流。**仅供参考，不在 skill 触发时被读取**。

---

## 场景

PRD：`docs/prd/login-v2.md`（虚构）声明：
1. R001：手机号+短信验证码登录，验证码 6 位 5 分钟有效
2. R002：连续失败 5 次锁定 30 分钟（时长可配置）

代码 diff（虚构）：
- `LoginController.java`：实现 `POST /login/sms`
- `LoginService.java`：失败计数 + 锁定，但锁定时长写死 `1800L`
- `LoginController.java:45`：`req.getPhone().trim()` 未做 null 检查

---

## 期望产物

- `requirements-20260514-1030.md`：见 [`requirements.md`](requirements.md)
- `review-20260514-1030.md`：见 [`review.md`](review.md)

---

## 学习要点

- R001 → ✅，R002 → 🟡（部分实现，缺配置化） — 这是「部分实现」典型例子
- `phone.trim()` NPE 关联到 R001，故归 ⚡ 实现风险，而非 🔴 代码硬伤