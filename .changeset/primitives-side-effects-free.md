---
"@vestlang/vestlang": patch
---

Faster cold start for consumers that don't validate a persisted template. The
`@vestlang/vestlang/authoring` subpath (and any code path that only authors or lints
vestlang) no longer builds the canonical vesting schema at import time — bundlers now
tree-shake roughly 20 ms of Zod setup out of it. Paths that do validate are unchanged.
