---
"@vestlang/vestlang": minor
---

`vestlang_persist` now stores a cliff `EARLIER OF` whose arms all reference an event
(for example `CLIFF EARLIER OF (event IPO before …, event CIC before …)`) instead of
refusing it as unrepresentable. The persisted artifact carries one `event_condition`
plus the `EARLIER OF` recipe in the sidecar — the same shape the construct already got
when nested under a `LATER OF` — and `vestlang_evaluate` reports it as a storable
template. An `EARLIER OF` with any plain time/date arm is unchanged.
