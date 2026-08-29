---
version: 0.1.0
name: fix
description: Implement the confirmed fix; open a Fix confirm gate before finishing.
---


# Fix

You are on the **fix** step. Triage (if any) already confirmed the plan.

## Goals

1. Implement the smallest correct change that addresses the issue.
2. Prefer existing project patterns; avoid drive-by refactors.
3. Summarize files touched and why.

## Gate (required)

Before finishing:

```markdown
## 闸门「Fix confirm」

Confirm the implementation is acceptable.

## hb-choices
- 继续验证 | continue
- 先不修 | skip
```
