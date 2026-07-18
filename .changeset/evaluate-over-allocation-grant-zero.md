---
"@vestlang/vestlang": patch
"@vestlang/core": patch
---

`vestlang_evaluate` now reports an over-allocating schedule as `valid: false` even
when `grant_quantity` is 0, matching `vestlang_persist`, `vestlang_lint`, and
rehydrate. A zero-share grant previously suppressed the over-allocation finding, so
these tools disagreed on the same program. Under-allocation stays silent at a
zero-share grant (there is nothing left to leave unvested). The `@vestlang/core`
template checkers `validateTemplateAllocatable` / `templateAllocationFindings` inherit
the fix and now flag an over-allocating template at grant 0.
