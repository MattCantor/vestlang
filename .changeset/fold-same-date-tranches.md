---
"@vestlang/vestlang": patch
---

The projection now presents one vested tranche per date. When a schedule lands
multiple installments on the same day — overlapping `PLUS` arms, or an events-only
grid the engine can't fold into a single template — the same-date amounts are
summed into one tranche with strictly increasing dates, instead of surfacing as
duplicate-date rows. `verifyObservations` grades against this folded projection, so
its nearest-tranche pointer reports the per-date total rather than one arm's slice.
Share totals and the over-allocation validity channel are unchanged.
