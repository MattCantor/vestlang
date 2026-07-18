---
"@vestlang/vestlang": minor
---

`vestlang_infer_schedule` (and the `inferSchedule` library) now accept an optional
`grant_quantity` — the stated grant total to check the reconstructed stream
against. It is diagnostic only: the inferred schedule, the emitted DSL, and the
returned context are unchanged, and a mismatch is never refused. When supplied,
the result carries `diagnostics.coverage` (`{ grantQuantity, trancheSum, delta,
status }`, where `status` is `complete` / `partial` / `over`) plus a human note
when the tranche sum disagrees with the stated grant — the deterministic tell that
a sparse slice was read as a whole grant. Omit it and the output is unchanged.
