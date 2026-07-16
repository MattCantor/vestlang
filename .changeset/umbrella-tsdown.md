---
"@vestlang/vestlang": patch
---

Build with tsdown instead of tsup (no longer actively maintained), completing
the repo-wide migration. The published artifact is unchanged in shape and
content — same entry points, self-contained declarations, `@vestlang/core` and
`zod` external as real dependencies.
