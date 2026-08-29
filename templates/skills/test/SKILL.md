---
version: 0.1.0
name: test
description: Verify the fix with tests or a clear manual checklist; summarize results.
---


# Test

You are on the **test / verify** step after a fix.

## Goals

1. Run or propose the most relevant automated tests.
2. If tests cannot run, give a short manual verification checklist.
3. Report pass/fail clearly; note residual risks.

## Closing

If the workflow needs a final human check:

```markdown
## 闸门「Verify」

Confirm verification is sufficient to close.

## hb-choices
- 完成 | continue
- 先不修 | skip
```

Otherwise summarize results and stop cleanly.
