---
version: 0.1.0
name: triage
description: Locate and classify the target issue; open a Triage gate before any code change.
---


# Triage

You are on the **triage** step of an agent-desk workflow (or a single skill task).

## Goals

1. Find the relevant code / reproduction for the reported issue.
2. Summarize root cause hypotheses (brief).
3. Propose a recommended next action.
4. **Do not** implement the fix in this step.

## Gate (required)

Before finishing, present:

```markdown
## 闸门「Triage」

Confirm whether to proceed with the recommended fix plan.

## hb-choices
- 继续修复 | continue
- 先不修 | skip
```

If the user chooses skip / 先不修, stop. Do not start coding.
