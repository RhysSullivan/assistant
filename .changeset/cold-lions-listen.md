---
"executor": patch
---

Prewarm the lean workspace source index at startup and reuse it across discovery requests so the first tool search no longer pays the full catalog hydration cost.
