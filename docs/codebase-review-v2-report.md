# Codebase health review, round 2 — report

**Date:** 2026-06-12 · **Tree:** main @ db4183a · **Brief:** `docs/scratch/codebase-review-v2-prompt.md`

## How this ran

Eleven first-wave agents under the brief's information rules: nine **blind hunters** (date arithmetic, allocation/rounding, vesting semantics, apps/MCP round-trips, test adequacy, duplication, type-model, abstraction, vestigial) and one **architecture** agent ran report-blind — none read the round-1 report; one **differential** auditor read it as primary input alongside the #174–#209 diffs. Every finding was routed to an independent adversarial verifier prompted to refute it against current source, with bug findings additionally required to reproduce via the MCP tools (89 agents total). The synthesis below was written without reading the round-1 report.

**Verification outcome:** 78 raw findings → 77 confirmed, 1 refuted. The refuted one was test-adequacy's claim that the persistence-critical parse∘stringify fixpoint is pinned for only one definition shape — its verifier found the commutation test it demanded already exists (`packages/evaluator/tests/resolve.lower.test.ts:249-274`, "lowering after the firing equals lowering before it plus rehydration") plus byte-equal round-trip pins across gates/selectors/offsets in `render/tests/stringify.spec.ts`; excluded. Two confirmed findings were killed as **round-1-deliberately-open** (evaluator's one-function `time.ts` adapter — the documented end-state of #194; and core `compile()` accepting statement percentage > 1 — #177's explicit, tested deferral); both appear in the Differential section as context, not findings. The 77 confirmed dedupe to the **54 distinct findings** below (B20 carries two manifestations of one root cause) — the headline bug was found independently by four streams.

**Headline judgment.** The fix wave landed remarkably well: the consolidations (#185–#193) are fully adopted with zero surviving old-pattern call sites, the DU wave (#195–#198) genuinely landed, every spot-checked fix shipped with a regression test, and the core date and allocation kernels survived every adversarial probe thrown at them. The defects that remain cluster in three places the wave didn't reach: **(1) the as-of accounting seam** — pending event shares vanish from the vested/unvested partition in several distinct ways, so the product's core question ("how much has vested?") gets materially wrong answers on ordinary mixed grants; **(2) the #209 persist/rehydrate lifecycle** — the newest surface, where the simplest event-anchored schedule can't be rehydrated and invalid artifacts enter the system of record; **(3) apps/mcp-server generally** — the one consumer that grew new surface after the wave, re-implementing seams the packages had just consolidated.

## Top 5

If only five things get done:

1. **Fix the as-of pending-shares accounting family as one PR** (B1 template-arm pending channel, B2 THEN-tail vanishing shares, B3 THEN-tail dropped cliff, with B7's raw-QUANTITY tally and B20's floor-vs-telescope reconciliation in the same sweep). Four streams found B1 independently because it is the worst thing in the codebase: `evaluate_as_of` certifies *full vesting* — `fully_vested_date` set, `unresolved: 0` — on grants where 25–67% of shares still wait on unfired events. Every fix touches the same few files (`lower.ts`/`classify.ts`/`assemble.ts`/`asof.ts`), and the events arm already shows the pattern (d2fce1f).
2. **Make synthetic event ids collision-proof** (B4). A user event named `evt_1` aliases the first minted synthetic: a still-contingent half of a grant vests off an unrelated firing, and persisted artifacts are corrupted. The fix is one line of policy — mint ids outside the DSL identifier alphabet — and makes the state unrepresentable.
3. **Harden the persist/rehydrate lifecycle** (B5 bare-event firings ignored, B6 over-allocating artifacts stored, B9 day-of-month drift, B15 impossible-as-pending, B16 raw parser throw). #209 shipped the happy path; five confirmed bugs sit in its seams, and it is the surface that feeds a system of record.
4. **Bound the #212 linter rule** (B8). A ~3 KB DSL input hangs `vestlang_lint` (exposed MCP tool, CLI on untrusted files) via an exponential window cross-product — the exact input-bounded-compute class the installment cap (c22fcc3) exists to prevent. Small fix: cap or restructure the cross-product.
5. **Add the two missing property tests** (T1 share-conservation invariant run over the existing corpus, T2 interchange firing-invariance beyond two handpicked shapes). T1 alone would have caught B1, B2, B7, and B20 — the suite's 11k assertion lines pin cases, not the invariant the engine exists to keep.

---

# Findings

## Bugs

Ranked by impact. B1–B3 are one family (the pending-head accounting seam in `resolve/lower.ts` + `asof.ts`); B5, B6, B9, B15, B16 are a second family (the #209 persist/rehydrate lifecycle). Every bug below carries a confirmed MCP repro re-verified against current source.

---

**B1** · Provenance: **blind-hunt × 3** (bugs-allocation, bugs-semantics, test-adequacy) **+ differential** — four independent discoveries; the differential stream's writeup (below) carries the round-1 context. The variants agree on cause and fix.

## Pending portions vanish from the as-of partition and summary on the TEMPLATE arm — the #182 pending-channel fix stopped at the events arm

**Category:** differential · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/types/src/evaluation.ts:169 (template arm: `installments: ResolvedInstallment[]` — no symbolic channel); packages/evaluator/src/resolve/assemble.ts:67-84 (template arm publishes only `compileToInstallments` output); packages/core/src/compile.ts:129 (`if (!firing) return null` — an unfired EVENT statement contributes zero installments); packages/evaluator/src/asof.ts:38-56 (partitionAsOf counts unresolved only from listed installments; the fallback fires only when ALL installments are absent); packages/pipeline/src/summary.ts:33,54-65 (total_unvested and fully_vested_date derive from that partition). Contrast: packages/evaluator/src/resolve/classify.ts:122-155 and resolve/types.ts:38-47, where the events arm now emits symbolic installments for pending siblings.

**Why it matters:** A grant where 25% waits on an unfired event but the rest is a plain date grid is a `template` verdict, and evaluate_as_of reports `unresolved: 0`, `total_unvested: 0`, and a `fully_vested_date` — certifying complete vesting while 1200 of 4800 shares are still gated. This is the exact B3/B4 over-certification failure mode the round-1 fix wave targeted, surviving on the sibling arm the fix didn't touch.

**Remedy:** Give the template arm the same pending channel the events arm got in d2fce1f: when a template statement is EVENT-based with no firing (PENDING_EVENT / SYNTHETIC_EVENT in the resolutions), emit its share claim as symbolic UNRESOLVED installments alongside the compiled ones (assembleVerdict has the ResolveResult; the unresolvedInstallments producer already renders exactly this shape). That requires widening the template arm's `installments` to the full Installment union — or, more conservatively, have partitionAsOf/computeSummary read the pending quantity off the template-arm blockers/resolutions instead of only the installment stream. Add an as-of test for a mixed DATE+pending-EVENT template program asserting unresolved > 0 and fully_vested_date === null.

**Repro:**
```
mcp__vestlang__vestlang_evaluate_as_of {"dsl": "0.75 VEST FROM DATE 2024-01-01 OVER 2 months EVERY 1 month PLUS 0.25 VEST FROM EVENT ipo OVER 2 months EVERY 1 month", "grant_date": "2024-01-01", "grant_quantity": 4800, "as_of": "2026-01-01"}
```

**Details (issue-ready):**

## Pending portions vanish from the as-of partition on the template arm

PR #182 (d2fce1f, closing #138/#148) fixed the round-1 B3/B4 family by giving the **events arm** a pending channel: a sibling portion still waiting on an event now rides along as symbolic UNRESOLVED installments plus blockers, so `partitionAsOf` tallies its shares as `unresolved` (verified working: the round-1 B4 repro now reports `unresolved: 1200`, `fully_vested_date: null`).

The **template arm has the identical hole and was not touched.** A bare unfired EVENT start deliberately lowers INTO the template (`PENDING_EVENT`, packages/evaluator/src/resolve/lower.ts:606-611), and core's compile skips an EVENT statement with no firing (packages/core/src/compile.ts:129). The template arm's published verdict carries only the compiled dated installments — its type forbids anything else (`installments: ResolvedInstallment[]`, packages/types/src/evaluation.ts:169; packages/evaluator/src/resolve/assemble.ts:67-84). The pending portion's shares therefore appear NOWHERE in the installment stream.

Downstream, `partitionAsOf` (packages/evaluator/src/asof.ts:38-56) computes `unresolved` only from UNRESOLVED installments, with a whole-quantity fallback only when the stream is completely empty. For a mixed program (one dated grid + one pending event portion) the pending shares are simply absent, so `computeSummary` (packages/pipeline/src/summary.ts:33,54-65) reports `total_unvested` without them and — because `unresolved === 0` and every unvested installment is RESOLVED — emits a **`fully_vested_date`** for a grant that is still 25% contingent.

**Observed** (vestlang_evaluate_as_of, dsl `0.75 VEST FROM DATE 2024-01-01 OVER 2 months EVERY 1 month PLUS 0.25 VEST FROM EVENT ipo OVER 2 months EVERY 1 month`, grant 4800, as_of 2026-01-01, ipo unfired):
```json
{"unresolved":0, "summary":{"total_vested":3600,"total_unvested":0,"percent_vested":0.75,"fully_vested_date":"2024-03-01"}}
```
1200 shares unaccounted for. Meanwhile `vestlang_evaluate` on the same input reports `pending: true` with an `EVENT_NOT_YET_OCCURRED ipo` blocker — the two tools contradict each other within the same model, which is precisely the inconsistency B4 was about. The per-clause breakdown shows the same root cause: the pending clause's entry has `installments: []` (its single-statement group is itself a template verdict), so the breakdown can't attribute the pending shares either.

**Fix sketch.** Either (a) widen the template arm's installments to the full `Installment` union (as d2fce1f already did for both events-only arms) and have `assembleVerdict` append symbolic installments for PENDING_EVENT/SYNTHETIC_EVENT statements, reusing `unresolvedInstallments`; or (b) keep the template projection purely dated but carry the pending quantity explicitly (e.g., on `ResolveResult` next to `cliffDate`) and have `partitionAsOf` add it to `unresolved`. Either way `fully_vested_date` must become null while any portion is pending. Add as-of + summary tests for the mixed template case.

Note: distinct from open issue #102 (absence-assumption disclosure of bare pending events) — this is share accounting, not disclosure.


---

**B2** · Provenance: **blind-hunt × 2** (type-model, test-adequacy) — independent discoveries; same seam as B1 (and fixable in the same PR).

## A THEN tail behind a pending head contributes no installment, so its share claim vanishes from every total (as-of unresolved, summary, breakdown)

**Category:** bug · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/src/resolve/classify.ts:182-185 (pending tail: blockers only, no installments); packages/evaluator/src/asof.ts:38-56 (partitionAsOf counts unresolved only from installments; fallbackQuantity only when the stream is EMPTY); packages/pipeline/src/summary.ts:33 (total_unvested = sum(unvested) + unresolved); contradicts the stated invariant at packages/evaluator/src/resolve/classify.ts:117-121 ("its shares are emitted as symbolic installments ... must not vanish") and packages/types/src/evaluation.ts:268-270 ("its share claim rides along symbolically rather than vanishing from the total")

**Why it matters:** On a 2,400-share grant, `1/2 VEST FROM EVENT ipo ... THEN 1/2 VEST ...` reports only 1,200 shares across vested+unvested+impossible+unresolved — the tail's 1,200-share claim is silently dropped from the published numbers, so total_unvested and percent-vested reads are wrong for any chained grant whose head hasn't fired.

**Remedy:** In unresolvedArm's pending-tail branch (classify.ts:182-185), emit the tail's quantity as symbolic installments (e.g. makeUnresolvedVestingStartSchedule(amountToQuantify(stmt.amount, ctx.grantQuantity), anchor blockers)) instead of returning blockers only — mirroring what eventsArm/unresolvedInstallments do for a non-chained pending start. unresolvedInstallments' chained guard (unresolved.ts:43-47) would then relax or the emission lives in classify. Add an assertion test: sum of all partition buckets + unresolved === total program claim.

**Repro:**
```
mcp__vestlang__vestlang_evaluate_as_of {"dsl": "1/2 VEST FROM EVENT ipo OVER 12 MONTHS EVERY 1 MONTH THEN 1/2 VEST OVER 12 MONTHS EVERY 1 MONTH", "grant_date": "2025-01-01", "grant_quantity": 2400, "as_of": "2026-01-01"} → {vested: [], unvested: [], impossible: [], unresolved: 1200, summary.total_unvested: 1200} — 1,200 of 2,400 shares unaccounted
```

**Details (issue-ready):**

## Summary

When a THEN chain's head is waiting on an unfired event, the chaining walk hands each tail `start: { state: "UNRESOLVED", blockers: <head's> }` (lower.ts:411-422). In the unresolved arm, `unresolvedArm` then handles such a tail by pushing only the head's blockers and emitting **no installment for the tail's own share claim** (classify.ts:182-185: "A tail whose chain head hasn't fired can't vest yet — it contributes no tranches, only the blocker").

That local choice breaks a global invariant the same file states for the events arm (classify.ts:117-121: a pending portion's "shares ... must not vanish") and that the published type docs promise (evaluation.ts:268-270). Every consumer that reads share totals off the installment stream under-counts:

- `partitionAsOf` (asof.ts:38-56) tallies `unresolved` from UNRESOLVED installments, and only falls back to the whole program quantity when the stream is **empty**. A mixed program (pending tail + any portion that does emit) drops the tail's shares entirely.
- `computeSummary` (pipeline/src/summary.ts:33) then reports `total_unvested` short by the tail's claim, and `fully_vested_date` is computed over an understated universe.
- `vestlang_evaluate`'s `installments` and `breakdown` show the same hole.

## Repro (verified against MCP and confirmed in current source)

```
vestlang_evaluate_as_of
  dsl: 1/2 VEST FROM EVENT ipo OVER 12 MONTHS EVERY 1 MONTH THEN 1/2 VEST OVER 12 MONTHS EVERY 1 MONTH
  grant_date: 2025-01-01, grant_quantity: 2400, as_of: 2026-01-01
→ { vested: [], unvested: [], impossible: [], unresolved: 1200 }
```

2,400 shares granted; 1,200 accounted. The head's 1,200 ride as an UNRESOLVED installment; the tail's 1,200 appear nowhere.

Side effect of the same branch: the head's `EVENT_NOT_YET_OCCURRED ipo` blocker is pushed twice (once by the head via unresolvedInstallments, once verbatim by the tail at classify.ts:183, since the tail's start.blockers are the head's anchor blockers), so the published blockers list carries duplicates.

## Existing test coverage

`resolve.then-chain.test.ts:538-553` ("event-origin THEN chain, event unfired") asserts only the blocker, never the installment totals — the drop is untested, not asserted-intentional.

## Suggested fix

Emit the pending tail's quantity as symbolic UNRESOLVED installments (same rendering as a non-chained pending start), and dedupe or scope the inherited head blockers. Add a conservation test: for every program/context, sum(installment amounts) + (fallback when empty) equals the program's total share claim.


---

**B3** · Provenance: **blind-hunt** (type-model) — sibling of B2: the same hand-fabricated pending-head tail record.

## A pending-head THEN tail's authored CLIFF is silently discarded (lowered to NONE), losing its blockers and mislabeling the interchange reason

**Category:** bug · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/src/resolve/lower.ts:411-421 (pending-tail branch hard-codes `cliff: { state: "NONE" }`, never reading stmt.expr.periodicity.cliff); contrast lower.ts:224-237 where a non-chained pending start lowers its cliff via lowerDeferredCliff precisely so "a cliff's own BEFORE/AFTER gate ... can be disclosed even while the start is unfired"; packages/evaluator/src/resolve/interchange.ts:44-46 + 48-64 (documented precedence: "The cliff causes win over the tail one", and the EVENT_CLIFF scan reads r.cliff.state === "EVENT" off the records this branch zeroed out)

**Why it matters:** A grant like `... FROM EVENT ipo ... THEN ... CLIFF EVENT fda` reports no `fda` blocker at all (a consumer watching blockers to know which events matter misses it) and the interchange verdict says EVENT_CHAINED_TAIL ("can't be dated until that event fires" — implying storable once ipo fires) when the schedule contains an event-anchored cliff that can never fit a template (EVENT_CLIFF), violating the module's own precedence rule.

**Remedy:** In resolveStatements' pending-anchor tail branch (lower.ts:419), lower the tail's cliff with lowerDeferredCliff(p.cliff, p.type, p.length, p.occurrences, ctx) instead of hard-coding NONE — exactly what resolveNonChained's pending path already does — so the cliff's EVENT/UNRESOLVED/IMPOSSIBLE record and its gate blockers survive onto the resolution record and the interchange reason scan.

**Repro:**
```
mcp__vestlang__vestlang_evaluate {"dsl": "1/2 VEST FROM EVENT ipo OVER 12 MONTHS EVERY 1 MONTH THEN 1/2 VEST OVER 12 MONTHS EVERY 1 MONTH CLIFF EVENT fda", "grant_date": "2025-01-01", "grant_quantity": 2400} → interchange.reason mentions only ipo (EVENT_CHAINED_TAIL), blockers contain no fda entry. Contrast: same CLIFF EVENT fda on a non-chained pending start reports "Event-anchored cliff on \"fda\" has no template form" (EVENT_CLIFF).
```

**Details (issue-ready):**

## Summary

`resolveStatements` handles a THEN tail whose chain anchor is PENDING by emitting `{ start: UNRESOLVED, cliff: { state: "NONE" }, chained: true }` (lower.ts:411-421). The tail's authored cliff expression (`stmt.expr.periodicity.cliff`) is never lowered — not even through `lowerDeferredCliff`, which exists for exactly this situation (a cliff with no anchor date yet) and which the non-chained pending path calls so that "a cliff's own BEFORE/AFTER gate [stays] on the record so it can be disclosed even while the start is unfired" (lower.ts:224-230).

## Observable consequences (MCP-verified, implied by current source)

1. **Missing blocker / disclosure**: `1/2 VEST FROM EVENT ipo OVER 12 MONTHS EVERY 1 MONTH THEN 1/2 VEST OVER 12 MONTHS EVERY 1 MONTH CLIFF EVENT fda` (grant 2025-01-01, 2400 shares, no firings) returns blockers naming only `ipo`. `fda` — an event the schedule genuinely gates on — appears nowhere in blockers, absenceAssumptions, or the reason. A gated cliff's BEFORE/AFTER blockers are likewise dropped.
2. **Interchange reason mislabel**: the interchange verdict reports `EVENT_CHAINED_TAIL` ("A THEN segment ... can't be dated until that event fires") — a *temporary* unstorability — when the program contains an event-anchored cliff, a *permanent* one (`EVENT_CLIFF`, "no template form"). `unresolvedReason` (interchange.ts:48-64) scans `r.cliff.state === "EVENT"` and documents "The cliff causes win over the tail one", but the scan can't see a cliff this branch zeroed to NONE. The same program without the THEN (non-chained pending start, same cliff) correctly reports EVENT_CLIFF.

The projection itself self-heals on re-evaluation (once the head fires, the tail re-resolves through lowerCliff), so this is a disclosure/verdict bug, not a vesting-amount bug.

## Suggested fix

Replace the hard-coded `cliff: { state: "NONE" }` at lower.ts:419 with `lowerDeferredCliff(p.cliff, p.type, p.length, p.occurrences, ctx)`. Note buildTemplate's guards (lower.ts:549-571) already route UNRESOLVED/EVENT cliffs to `unresolved`, so the verdict routing is unchanged — only the carried record gets truthful. Add a test mirroring resolve.classify.test.ts:623's resolved-head case but with a pending head, asserting the fda blocker and the EVENT_CLIFF interchange reason.


---

**B4** · Provenance: **architecture** (found while auditing the synthetic-event namespace; bug in its own right).

## Synthetic event ids (evt_N) collide with the user's event namespace — over-vests a contingent grant and shadows real events

**Category:** architecture · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/src/resolve/lower.ts:586-595 (mintSynthetic: `evt_${++synthOrdinal}`, deduped only by definition, never checked against the program's own event names); lower.ts:631-641 (fired offset anchors mint into the same namespace; user firings recorded under the shared id); packages/dsl/src/grammar/40-anchors.peggy:3 (Ident = [A-Za-z_][A-Za-z0-9_]* — `evt_1` is a legal user event id); packages/core/src/compile.ts:127-135 (a firing fans out to every statement sharing event_id); packages/evaluator/src/resolve/rehydrate.ts:113-124 (any sourceMap id is treated as synthetic and its re-resolution overrides the runtime firing)

**Why it matters:** A user who names an event `evt_1` aliases it with the first minted synthetic: the engine then vests a still-contingent portion off an unrelated firing (empirically over-vests 50% of the grant while its real gates are unfired), and the persisted artifact + rehydrate path silently shadow the user's real event.

**Remedy:** Mint synthetic ids outside the DSL identifier alphabet — canonical `event_id` is an unconstrained string (types/canonical.ts:58, persist.ts zod z.string().min(1)), so e.g. `vestlang:evt:1` is conformant and can never collide with an Ident. Alternatively (or additionally) collect the program's referenced event names via @vestlang/walk's referencesEvent before minting and skip taken ids, and add a validator/persist guard that sidecar keys never coincide with named-event firings.

**Repro:**
```
mcp__vestlang__vestlang_evaluate {"dsl": "1/2 VEST FROM LATER OF(EVENT a, EVENT b) OVER 4 months EVERY 1 month PLUS 1/2 VEST FROM EVENT evt_1 OVER 4 months EVERY 1 month", "grant_date": "2026-01-01", "grant_quantity": 1000, "events": {"evt_1": "2026-06-01"}}
```

**Details (issue-ready):**

## Summary

`buildTemplate` mints synthetic event ids as `evt_${++synthOrdinal}` (packages/evaluator/src/resolve/lower.ts:591) with no check against the event names the program itself references. The DSL's `Ident` rule (`[A-Za-z_][A-Za-z0-9_]*`, packages/dsl/src/grammar/40-anchors.peggy:3) admits `evt_1` as a perfectly legal user event name, so the two namespaces collide.

## Repro 1 — over-vesting in the live evaluate path

```
vestlang_evaluate
dsl: 1/2 VEST FROM LATER OF(EVENT a, EVENT b) OVER 4 months EVERY 1 month PLUS 1/2 VEST FROM EVENT evt_1 OVER 4 months EVERY 1 month
grant_date: 2026-01-01, grant_quantity: 1000, events: {"evt_1": "2026-06-01"}
```

The `LATER OF (EVENT a, EVENT b)` start is pending, so it lowers as a synthetic event minted `evt_1` — the same id as the user's genuine `FROM EVENT evt_1`. buildTemplate then records the user's firing under that shared id (lower.ts:634-641), and core's compile fans one firing out to every statement with that event_id (packages/core/src/compile.ts:127-135). Observed output: **all 1000 shares scheduled (8 × 125)** while the blockers still report `a` and `b` unfired — the contingent half vests off an unrelated firing. The `breakdown` totals only 500, internally inconsistent with the headline installments (1000), confirming the conflation happens in the collapse.

## Repro 2 — corrupted persisted artifact

`vestlang_persist` on the same DSL (no firings) returns a template whose **both** statements carry `vesting_base: {type: "EVENT", event_id: "evt_1"}`, with the sidecar claiming `evt_1` is defined as `LATER OF (EVENT a, EVENT b)`. A record keeper applying a firing for the user's real `evt_1` vests both halves.

## Repro 3 — rehydrate shadows the user's event

`vestlang_rehydrate` on that artifact with `events: {"evt_1": "2026-06-01"}` returns `firings_to_apply: []` and an **empty projection**: rehydrate treats any sourceMap id as synthetic (rehydrate.ts:113-124), re-resolves the combinator definition (still pending), and the user's actual firing of their own `evt_1` never reaches the statement that genuinely references it.

All 73 tests pass on main — this is an untested gap. Verified against current source, not just the (possibly stale) MCP build: lower.ts:586-595 has no reservation or collision check.

## Fix sketch

`event_id` in the canonical interchange is an unconstrained string (types/canonical.ts:58; persist.ts zod `z.string().min(1)`), so the cleanest fix is to mint ids outside the DSL identifier alphabet — e.g. `vestlang:evt:1` — making collision *unrepresentable* rather than checked. If keeping the short ids matters for the demo story, scan the program's referenced event names (walk's `referencesEvent` infrastructure already exists) and skip colliding ordinals; either way, add a guard (in `assertValidVestingRuntime` or persist) that sourceMap keys never coincide with non-synthetic firing ids, so a hand-built artifact can't reintroduce the aliasing.


---

**B5** · Provenance: **blind-hunt × 2** (bugs-dates, bugs-apps) — independent discoveries with matching repros.

## vestlang_rehydrate silently ignores firings of bare named EVENT statements — empty projection, empty pending, empty action list

**Category:** bug · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/src/resolve/rehydrate.ts:113-124 (witness loop iterates only Object.entries(sourceMap)); packages/evaluator/src/resolve/rehydrate.ts:99-103 (templateEventIds computed but used only to filter sourceMap ids); apps/mcp-server/src/persist.ts:246-278 (runRehydrate compiles the projection from result.runtime, which never gains a named-event firing, and `pending` is only result.blockers from the sourceMap loop); packages/evaluator/src/resolve/lower.ts:606-611 (a bare unfired EVENT start lowers to an EVENT statement with NO source-map entry); core would accept the merged firing: packages/core/src/validate.ts:286-318 validates eventFirings against exactly these EVENT statements.

**Why it matters:** The simplest event-anchored schedule the interchange supports (CLAUDE.md §4's flagship: an EVENT-anchored start IS template-expressible) breaks the #209 persist/rehydrate lifecycle: after the event fires, rehydrate reports nothing to apply, nothing pending, and an empty projection — actively telling a record keeper the grant vests nothing.

**Remedy:** In rehydrate(), after the sourceMap loop, walk templateEventIds that have no sourceMap entry: if ctx.events[eventId] is set, merge { event_id, date } into firings (same override-by-id semantics); otherwise emit an EVENT_NOT_YET_OCCURRED blocker so `pending` names the unfired event. Add a persist→rehydrate test for the bare `VEST FROM EVENT ipo …` case (apps/mcp-server/tests/persist.test.ts covers only the combinator-sidecar and plain time-based cases).

**Repro:**
```
mcp__vestlang__vestlang_rehydrate {"artifact": {"template": {"id": "resolved", "statements": [{"order": 1, "vesting_base": {"type": "EVENT", "event_id": "ipo"}, "occurrences": 4, "period": 1, "period_type": "MONTHS", "percentage": {"numerator": 1, "denominator": 1}, "cliff": {"length": 2, "period_type": "MONTHS", "percentage": {"numerator": 1, "denominator": 2}}}]}, "runtime": {"grantDate": "2025-01-01"}}, "grant_date": "2025-01-01", "grant_quantity": 400, "events": {"ipo": "2025-01-31"}} → {"firings_to_apply":[],"pending":[],"projection":[]} (artifact produced verbatim by vestlang_persist on "VEST FROM EVENT ipo OVER 4 months EVERY 1 month CLIFF +2 months")
```

**Details (issue-ready):**

## Summary

A program with a bare named EVENT start (`VEST FROM EVENT ipo OVER 4 months EVERY 1 month CLIFF +2 months`) persists fine: `vestlang_persist` returns a template with `vesting_base: {type: "EVENT", event_id: "ipo"}` and an advisory blocker naming `ipo`. But `vestlang_rehydrate` on that artifact — with `events: {"ipo": "2025-01-31"}` supplied exactly as the tool input documents ("supply newly-fired events in the events map") — returns `{"firings_to_apply":[],"pending":[],"projection":[]}`. The same call WITHOUT the firing also returns `pending: []`, so the unfired event isn't even disclosed as pending.

## Cause

`rehydrate()` (packages/evaluator/src/resolve/rehydrate.ts:113-124) computes witnesses only for **synthetic** events: it iterates `Object.entries(sourceMap)`. A bare named EVENT start is lowered by `buildTemplate` (packages/evaluator/src/resolve/lower.ts:606-611) as an EVENT statement with **no source-map entry** — there is no sidecar for it. So:

- the world's `ctx.events["ipo"]` is never merged into `runtime.eventFirings`;
- `runRehydrate` (apps/mcp-server/src/persist.ts:274-278) compiles the projection from that unchanged runtime — `compileRaw` skips the EVENT statement with no firing (packages/core/src/compile.ts:128-129) — so the projection is empty;
- `pending` is only `result.blockers`, which the sourceMap loop populates, so it is empty too.

The doc comment in rehydrate.ts itself says firings arrive "attested by the caller in `ctx.events`, the same channel `evaluateVestingBase` already reads" — but that channel is only consulted for synthetic definitions.

Note the merge is exactly what core's runtime validator is shaped to accept: `validateVestingRuntime` (packages/core/src/validate.ts:286-318) permits firings precisely for event_ids that appear on EVENT statements. And `buildTemplate` already records `{ipo, date}` in `runtime.eventFirings` when the event is fired at persist time (lower.ts:634-640), so the stored artifact shape expects named firings in the runtime — rehydration just never adds them.

## Fix sketch

After the sourceMap loop in `rehydrate()`, for each `templateEventIds` member with no sourceMap entry: if `ctx.events[id]` is set, `firings.set(id, {event_id: id, date: ctx.events[id]})`; else push `{type: "EVENT_NOT_YET_OCCURRED", event: id}` so `pending` names it. 

## Test gap

apps/mcp-server/tests/persist.test.ts pins the combinator-with-sidecar case and the plain time-based case; the bare named EVENT case (the one canonical's EVENT vesting_base exists for) has no coverage on either side of the firing.


---

**B6** · Provenance: **blind-hunt × 2** (bugs-allocation, bugs-apps) — independent discoveries. The allocation stream adds: pipeline/present.ts already refuses to present over-allocating tranches, so persist is the one surface that ignores the findings channel.

## vestlang_persist stores invalid (over-allocating) programs; the rehydrated projection allocates more shares than the grant

**Category:** bug · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** apps/mcp-server/src/persist.ts:178-191 (runPersist gates only on `resolution.status !== "template"`; never reads `schedule.findings` / validity); contrast packages/pipeline/src/view.ts:120-128 where evaluate surfaces `valid` + findings

**Why it matters:** `6000 VEST FROM DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS` with grant_quantity 4800 evaluates with `valid: false` (over-allocation finding), yet persists with `ok: true` and rehydrates to a projection of 4×1500 = 6000 shares against a 4800-share grant — the lifecycle whose whole point is feeding a system of record stores a schedule the evaluator itself flags as not a valid schedule.

**Remedy:** In `runPersist`, after evaluating, refuse (or at minimum return alongside the artifact) when the schedule carries error-severity findings / `valid === false` — the data is already on the `EvaluatedSchedule` returned by `evaluateProgram` at apps/mcp-server/src/persist.ts:170. Add a persist test with an over-allocating quantity program.

**Repro:**
```
mcp__vestlang__vestlang_persist {"dsl":"6000 VEST FROM DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS","grant_date":"2025-01-01","grant_quantity":4800} → ok; then vestlang_rehydrate with the artifact and grant_quantity 4800 → projection sums to 6000.
```

**Details (issue-ready):**

## Summary

`runPersist` (apps/mcp-server/src/persist.ts:152-192) checks exactly one thing about the evaluated schedule: `resolution.status === "template"`. It never consults `schedule.findings` or the validity the evaluate tool exposes (`valid: false` when the program allocates more than the grant — see the `vestlang_evaluate` contract and packages/pipeline/src/view.ts:120-128).

So a program that `vestlang_evaluate` reports as `valid: false` with an over-allocation finding still persists cleanly:

- DSL: `6000 VEST FROM DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS`, grant_quantity 4800
- `vestlang_evaluate` → `valid: false`, finding `over-allocation`
- `vestlang_persist` → `ok: true` (quantity amounts normalize to a 5/4 percentage in the template)
- `vestlang_rehydrate` (grant_quantity 4800) → projection `[1500, 1500, 1500, 1500]` = **6000 shares vested on a 4800-share grant**, with no warning anywhere.

(The PLUS over-allocation variant `1/2 … PLUS 3/4 …` happens to be refused, but only incidentally — it resolves events-only, not because anyone checked validity.)

## Why it matters

The persist artifact is positioned as what a record keeper stores; core's allocator (packages/core/src/kernel.ts) faithfully allocates cumulative fractions above 1, so nothing downstream catches it. Evaluate and persist disagree about whether the same program is acceptable, and persist is the surface where the mistake becomes durable.

## Fix sketch

`runPersist` already holds the `EvaluatedSchedule` (persist.ts:170). Either:
- refuse when `schedule.findings` contains an error-severity finding (mirroring how `valid` is derived in pipeline's `presentSchedule`), with a message naming the finding; or
- persist but return `findings` alongside `blockers` so the caller must confront them.

Refusal seems more in keeping with the tool's existing 'only a clean template is storable' stance.

## Test gap

apps/mcp-server/tests/persist.test.ts has no invalid-program case.


---

**B7** · Provenance: **blind-hunt** (bugs-allocation).

## As-of unresolved tally takes QUANTITY claims raw: reports 150 unvested shares on a 100-share grant and 100 on a zero-share grant

**Category:** bug · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/src/utils.ts:29-36 (amountToQuantify returns a QUANTITY's a.value uncapped, ignoring grantQuantity); packages/evaluator/src/resolve/unresolved.ts:48 (symbolic installments sized from it); packages/evaluator/src/asof.ts:95-97 (programQuantity fallback sums the same raw claims); contrast packages/evaluator/src/resolve/lower.ts:50-55 (the resolve path clamps QUANTITY to ZERO on a zero-share grant and lowers v/totalShares otherwise) and packages/evaluator/src/resolve/index.ts:144-145 (findings suppressed entirely when totalShares === 0)

**Why it matters:** vestlang_evaluate_as_of has no findings channel, so its totals are the only truth a consumer sees — and they can exceed the grant (total_unvested 150 of 100) or invent shares on a zero-share grant (100 of 0), disagreeing with the resolve path's own clamping and with vestlang_evaluate's valid flag on the same input.

**Remedy:** Cap the symbolic integer claim at the grant: in amountToQuantify, QUANTITY → Math.min(a.value, grantQuantity) (and 0 on a zero grant, matching amountToFraction's clamp at lower.ts:50-55). Alternatively surface findings on the as-of path so an over-claiming tally is at least flagged.

**Repro:**
```
mcp__vestlang__vestlang_evaluate_as_of {"dsl":"150 VEST FROM EVENT a OVER 2 months EVERY 1 month","grant_date":"2024-01-01","grant_quantity":100,"as_of":"2026-06-01"}
```

**Details (issue-ready):**

## Summary

The symbolic/as-of side sizes a statement's integer share claim with `amountToQuantify` (evaluator/src/utils.ts:29-36), which returns a QUANTITY amount's raw `a.value` without ever looking at the grant. The resolve/compile side lowers the same amount through `amountToFraction` (resolve/lower.ts:50-55), which clamps a QUANTITY on a zero-share grant to ZERO and otherwise expresses it as v/totalShares so over-allocation is at least surfaced as an error finding. The two disagree, and only the unguarded one feeds `vestlang_evaluate_as_of`, which has no findings channel.

## Repros

1. `vestlang_evaluate_as_of` with dsl `"150 VEST FROM EVENT a OVER 2 months EVERY 1 month"`, grant_quantity 100 → `unresolved: 150`, `summary.total_unvested: 150`. The as-of view claims one-and-a-half grants are still coming, with no over-allocation signal anywhere in the response.
2. Same tool, dsl `"100 VEST OVER 2 months EVERY 1 month"`, grant_quantity 0 → `unresolved: 100`, `total_unvested: 100` on a grant of zero shares. Worse, `vestlang_evaluate` on the identical input reports `valid: true` with empty installments, because amountToFraction clamps the portion to ZERO and allocation findings are suppressed for totalShares === 0 (resolve/index.ts:144-145) — the two tools tell contradictory stories.

Sources: the symbolic installment quantity (unresolved.ts:48) and the empty-projection fallback (asof.ts:95-97) both flow from utils.ts:29-36.

## Related, deliberately-pinned behavior (not re-litigated here)

PORTION claims floor independently per statement (floorSharesAt of each fraction), so three pending 1/3 portions over 100 shares tally `unresolved: 99` while the eventual joint allocation telescopes to 100. That per-statement floor is asserted by evaluator/tests/portion-integer-claim.test.ts:60-78 ("3 × floor(100/3) = 99") and traces to #176, so I treat the one-share shortfall as a decided trade-off — but if the QUANTITY side gets fixed, it's worth deciding whether the floors should instead be sized against a running cumulative so the symbolic tally matches what the allocator will actually deliver.

## Suggested fix

Clamp QUANTITY in amountToQuantify to `grantQuantity` (0 on a zero grant), keeping it consistent with amountToFraction; add as-of tests for both repros.


---

**B8** · Provenance: **differential** (introduced by #212, the freshest fix-wave follow-up).

## #212's unsatisfiable-date-window rule does an exponential window cross-product — a ~3 KB DSL input can hang the linter (MCP/CLI DoS)

**Category:** differential · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/linter/src/rules/unsatisfiable-date-window.ts:76-92 — the AND case cross-products conjunct windows (`acc.flatMap((w) => ws.map((x) => intersect(w, x)))`) and the OR case concatenates, so n conjuncts that each contain a 2-arm OR yield 2^n Window objects before `windows.every(isEmpty)` at :124 ever runs. Measured against the built linter on this tree: 10 groups 7 ms, 16 groups 51 ms, 20 groups 760 ms, 22 groups 2511 ms — clean 2^n scaling.

**Why it matters:** vestlang_lint is an exposed MCP tool (and the CLI lints untrusted files); 30 OR-pair conjuncts (~3 KB of DSL) is ~10 minutes and gigabytes of allocation, 40 is effectively forever. The repo already treats input-bounded compute as a hard requirement (the installment cap, commit c22fcc3), and this rule — added two days ago in the freshest fix-wave follow-up — reintroduces the class.

**Remedy:** The check is 1-D satisfiability, which is polynomial: represent each conjunct's OR as a merged set of disjoint date intervals and intersect interval-sets pairwise across conjuncts (n·k log k), instead of materializing the DNF cross-product. If that's more than the rule wants to be, cap the expansion (e.g., bail out — under-reporting, which the rule's own comment at :63-64 already sanctions — once the window list exceeds a few thousand). Add a lint test with ~30 OR-pair conjuncts asserting bounded runtime.

**Repro:**
```
mcp__vestlang__vestlang_lint {"dsl": "VEST FROM DATE 2026-06-15 (AFTER DATE 2026-01-01 OR AFTER DATE 2026-01-02) AND (AFTER DATE 2026-01-03 OR AFTER DATE 2026-01-04) AND ... OVER 12 months EVERY 1 month"} — extend the pattern to n distinct (AFTER d1 OR AFTER d2) groups; runtime doubles per group (22 groups ≈ 2.5 s locally; do not run ≥30 against a live server). Dates must be distinct per group or the normalizer dedupes the conjuncts.
```

**Details (issue-ready):**

## unsatisfiable-date-window: exponential window expansion on AND-of-OR conditions

PR #212 (57236eb) added `unsatisfiable-date-window`. Its `windowsOf` computes the full DNF of a condition's date windows: the AND case is a cross-product (`packages/linter/src/rules/unsatisfiable-date-window.ts:80-84`), the OR case a concatenation (:87-88). A condition of n conjuncts, each a 2-alternative OR — `(AFTER d1 OR AFTER d2) AND (AFTER d3 OR AFTER d4) AND ...` — therefore materializes 2^n `Window` objects (each step also allocating the intermediate arrays) before the emptiness check at :124 runs.

The grammar accepts grouped boolean conditions on any gated node, so this is reachable from plain DSL text. Measured on the current tree (node, built `packages/linter/dist`):

| OR-pair conjuncts | windows | time |
|---|---|---|
| 10 | 2^10 | 7 ms |
| 16 | 2^16 | 51 ms |
| 20 | 2^20 | 760 ms |
| 22 | 2^22 | 2511 ms |

Extrapolating the clean doubling: 30 conjuncts ≈ 10 min, 40 ≈ centuries — i.e., a few-KB lint input pins the MCP server or CLI process. (Conjuncts must use distinct dates; identical groups get deduped by the normalizer first.) Note the rule runs on every NODE with a condition, via the default-on recommended set.

This is the same hazard class the installment cap exists for (c22fcc3: "bound installments a schedule may materialize (DoS)") — the linter previously had no super-linear path; #212 introduced one.

**Fix sketch.** Emptiness of an AND-of-ORs of date intervals over a single variable doesn't need DNF: convert each conjunct to a union of disjoint intervals (merge its OR alternatives — at most a handful each), then fold an intersection of interval-sets across conjuncts; the running set stays small (bounded by total atom count) and the whole check is near-linear. Alternatively, keep the current code but bail out (treat as satisfiable — the rule is explicitly allowed to under-report, see the comment at :63-64) once `windows.length` crosses a cap (e.g., 4096). The anchor-inside-window check at :138-156 needs the same treatment.


---

**B9** · Provenance: **blind-hunt** (bugs-apps).

## Rehydration re-resolves synthetic witnesses under the caller's (or default) day-of-month rule, ignoring the rule stored in the artifact runtime — firings_to_apply dates shift

**Category:** bug · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** apps/mcp-server/src/persist.ts:247-255 (ctxInput built from input.vesting_day_of_month only; artifact.runtime.vestingDayOfMonth never consulted); packages/evaluator/src/resolve/rehydrate.ts:95 (createEvaluationContext defaults the rule when absent)

**Why it matters:** The artifact already stores the grant's day-of-month convention (runtime.vestingDayOfMonth, written by persist), but the witness re-resolution reads the rule from the rehydrate call instead: for stored rule '15', definition `EVENT ipo +1 month`, ipo fired 2025-01-31, rehydrate without re-passing the rule emits firing 2025-02-28; re-passing '15' emits 2025-02-15 — two different action-list dates for the system of record depending on whether the caller re-supplies a setting the artifact already carries.

**Remedy:** Default the rehydration context's `vesting_day_of_month` from `artifact.runtime.vestingDayOfMonth` (either in `runRehydrate` before building ctxInput, or inside evaluator's `rehydrate`, which receives the runtime). Same consideration applies to `grant_date`: the tool requires the caller to repeat it while `runtime.grantDate` is stored — derive it and drop a footgun.

**Repro:**
```
mcp__vestlang__vestlang_persist {"dsl":"VEST FROM EVENT ipo + 1 month OVER 4 MONTHS EVERY 1 MONTH","grant_date":"2025-01-01","grant_quantity":400,"vesting_day_of_month":"15"}; then vestlang_rehydrate with that artifact, events {"ipo":"2025-01-31"} and NO vesting_day_of_month → firings_to_apply [{evt_1: 2025-02-28}]; with vesting_day_of_month "15" → [{evt_1: 2025-02-15}].
```

**Details (issue-ready):**

## Summary

`vestlang_persist` stores the evaluation's day-of-month convention in the artifact (`runtime.vestingDayOfMonth` — confirmed: persisting with `vesting_day_of_month: "15"` yields `runtime: {startDate…, grantDate…, vestingDayOfMonth: "15"}`). But `runRehydrate` (apps/mcp-server/src/persist.ts:247-255) builds the re-resolution context exclusively from the *call's* `vesting_day_of_month`, falling back to the global default inside `createEvaluationContext` (packages/evaluator/src/resolve/rehydrate.ts:95). The stored rule is used only by `compileToInstallments` for the projection grid (because that reads `result.runtime` directly).

Consequence: the synthetic-witness dates — the `firings_to_apply` delta, i.e. the action list against the system of record — depend on the caller remembering to re-pass a convention that is already persisted.

Demonstration (dist build, matches source):
- persist `VEST FROM EVENT ipo + 1 month OVER 4 MONTHS EVERY 1 MONTH`, dom `15` → sidecar `evt_1: "EVENT ipo +1 month"`, runtime stores `vestingDayOfMonth: "15"`
- rehydrate, ipo fired **2025-01-31**, no dom passed → `firings_to_apply: [{evt_1, 2025-02-28}]` (default rule clamps Jan 31 + 1mo)
- rehydrate, dom `15` passed → `[{evt_1, 2025-02-15}]`

The projection happens to coincide in this example (the grid is computed under the stored rule either way), which makes the inconsistent firing date harder to notice, not easier.

## Fix sketch

Treat the artifact as authoritative for its own conventions: in `runRehydrate`, `vesting_day_of_month: input.vesting_day_of_month ?? input.artifact.runtime.vestingDayOfMonth`. Better, do it inside evaluator `rehydrate()` which already receives `runtime` — then every consumer of `rehydratePersisted` gets it. Consider the same for `grantDate` (`runtime.grantDate` is stored; the tool currently asks the caller to "pass the same grant_date the artifact was built with" and trusts them).

## Test gap

No rehydrate test exercises a non-default day-of-month rule.


---

**B10** · Provenance: **blind-hunt** (bugs-semantics) — a semantics re-decide more than a straight bug; two tests pin the current wait deliberately, but the hunter argues the guard was transplanted from the gate/LATER-OF context where it is sound into the one selector direction where it isn't.

## EARLIER OF with a settled date arm never commits: the resolution verdict reports zero vested forever (and never vests at all if the event never fires)

**Category:** differential · **Confidence:** medium · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/src/evaluate/selectors.ts:100-119 (EARLIER_POLICY: selectorIsSatisfied requires every live arm resolved, partialEmit false; rationale comment at 91-98), selectors.ts:162-204 (no commit and no `withBoundary` stamping on the plain-unresolved branch); packages/evaluator/src/resolve/lower.ts:249-268 (pending combinator → SYNTHETIC_EVENT, projection empty); packages/evaluator/src/resolve/rehydrate.ts:113-124 (rehydration re-resolves the same definition with the same selector machinery, so the stored synthetic witness never arrives either). Intent asserted in tests: packages/evaluator/tests/assemble.test.ts:328-355, packages/pipeline/tests/summary.spec.ts:207-220.

**Why it matters:** `EARLIER OF (DATE d, EVENT e)` is documented as "first to occur — acts like an OR", yet if `e` never fires the engine never starts the grant: the date arm can never win, so the closed-world resolution verdict reports 0 vested indefinitely, years past d. Committing to the resolved arm is sound in every world for a start anchor — a later firing leaves the date arm the winner, and a backdated firing only moves the start earlier (more vested), so the date-arm projection is a guaranteed floor — and the absenceAssumptions channel exists precisely to commit-with-disclosure.

**Remedy:** Re-decide EARLIER_OF's partial policy for the resolution verdict: when at least one arm has resolved, commit to the earliest resolved date (mirror of LATER_OF's partialEmit), stamping the pending arms' blockers `through` that date via withBoundary so absenceAssumptions discloses the dependency ("e did not occur on/before d"). The interchange verdict stays as-is (firing-blind, synthetic event), preserving the two-verdict split. The two intent-asserting tests would be updated as part of the decision. If the wait is re-affirmed instead, the grammar doc's "first to occur (acting like an OR)" and §4's "closed-world, reading known firings" description of the resolution verdict need correcting, and EARLIER_OF pending blockers should at least be stamped with the resolved arm's date so the disclosure machinery sees the yardstick.

**Repro:**
```
vestlang_evaluate_as_of {"dsl": "VEST FROM EARLIER OF ( DATE 2024-06-01, EVENT ipo ) OVER 12 months EVERY 1 month", "grant_date": "2024-01-01", "grant_quantity": 120, "as_of": "2026-06-01"}
```

**Details (issue-ready):**

## Summary

For a start anchor `EARLIER OF ( DATE 2024-06-01, EVENT ipo )` with ipo unfired, the resolution verdict is a pending `template` (synthetic event) with an empty projection, and `evaluate_as_of` at 2026-06-01 reports `vested: [], unresolved: 120` — even though the start is, by construction, no later than 2024-06-01 in every possible world, and the grant would be fully vested by 2025-06-01 under any non-backdated firing history. `absenceAssumptions` is also empty: the pending blocker is never stamped with the date arm it is being measured against (no `withBoundary` call on selectors.ts:194-203, unlike LATER_OF's partial emit at 168-190 and the gate path in constraint.ts:117-127).

If ipo *never* fires, the grant never vests in the resolution view — the date arm can never win under the all-arms-must-resolve policy (`EARLIER_POLICY.selectorIsSatisfied`, selectors.ts:107-112). The same applies to schedule-level `EARLIER START OF`, and to the persisted artifact: rehydrate.ts re-resolves the stored definition with the same selector machinery, so the synthetic witness never materializes.

## Why this is worth re-deciding rather than a straight bug report

The wait is deliberate: selectors.ts:91-98 and two tests (assemble.test.ts:328-332 "could be recorded earlier than 2030, so the date isn't provably the earliest"; summary.spec.ts:207-209) assert it, guarding against backdated firings. But the asymmetry with LATER_OF is hard to justify *for vesting amounts*: 

- LATER_OF partial-commits (PICKED with UNRESOLVED meta, floor disclosed via `through`), accepting that a backdated firing could change details, because the floor is safe.
- EARLIER_OF refuses to commit, yet committing to the earliest resolved arm is *also* safe in the same direction: a future firing leaves the date arm the winner outright; a backdated firing moves the start earlier, so actual vesting ≥ the committed projection. The committed answer is a floor, never an over-statement.
- Meanwhile CLAUDE.md §4 defines the resolution verdict as "closed-world, reading known firings" — under a closed-world reading, an absent firing means the event hasn't happened, so the earlier-of *is* the date. The whole `absenceAssumptions` mechanism (assemble.ts:28-62) exists to make exactly this commitment safe to disclose.
- The grammar resource documents EARLIER OF as "selects the first to occur (acting like an OR)". An OR whose decided branch can never win unless the undecided branch also decides is not an OR.

## Repro

```
vestlang_evaluate_as_of
dsl: VEST FROM EARLIER OF ( DATE 2024-06-01, EVENT ipo ) OVER 12 months EVERY 1 month
grant_date: 2024-01-01, grant_quantity: 120, as_of: 2026-06-01, events: {}
```
Actual: `vested: [], unresolved: 120, percent_vested: 0`. Expected (under the closed-world definition): 120 vested with `absenceAssumptions: [{eventId: "ipo", through: ...}]`.

## Fix sketch

Give EARLIER_OF a partial-commit policy symmetric to LATER_OF's: with ≥1 resolved arm, return PICKED on the earliest resolved date with the pending arms' blockers stamped `through` that date (resolution verdict only; the firing-blind interchange continues to externalize the combinator as a synthetic event). Update the two intent tests. Alternatively, re-affirm the wait explicitly and fix the contradicting documentation plus the missing `through` stamping.


---

**B11** · Provenance: **blind-hunt** (bugs-dates); the differential stream observed the same off-by-one independently and noted it predates the fix wave (pinned as intended by makeTranches.test.ts:35).

## START_PLUS symbolic installments are one period early: steps start at 0, but the resolved grid places occurrence i at start + i*period (i >= 1)

**Category:** differential · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/src/evaluate/makeTranches.ts:90 (symbolicDate: { type: "START_PLUS", unit, steps: i * steplength }, i from 0); vs the grid convention: packages/core/src/kernel.ts:75-83 (gridDate: "occurrence i lands i periods past the anchor") and kernel.ts:121-126 (evenGrid emits at(idx + 1)); packages/evaluator/src/resolve/unresolved.ts:92-94 (the resolved-start path of the SAME renderer lays dates at(i + 1)); callers: unresolved.ts:66-74 and 126.

**Why it matters:** The symbolic preview a record keeper sees for a pending-start schedule claims the first tranche vests AT the start (steps: 0) and the last at start + (N-1) periods, but when the anchor resolves the engine vests at start + 1 .. start + N periods — every tranche is reported one period early, including the final vest date.

**Remedy:** Emit steps: (i + 1) * steplength in makeStartPlusSchedule (and update makeTranches.test.ts, which pins steps 0/3/6 for steplength 3 — should be 3/6/9), or, if steps was meant to be measured from the first vest rather than the start, rename/document the symbolic date so a consumer can't misread it; the former matches the engine's own anchor convention everywhere else.

**Repro:**
```
mcp__vestlang__vestlang_evaluate {"dsl": "VEST FROM LATER OF(grantDate + 12 months, EVENT ipo) OVER 4 months EVERY 1 month CLIFF EVENT board", "grant_date": "2025-01-01", "grant_quantity": 400} → symbolic installments steps 0,1,2,3 (MONTHS). Contrast the resolved form of the same cadence: mcp__vestlang__vestlang_evaluate {"dsl": "VEST FROM EVENT ipo OVER 4 months EVERY 1 month", "grant_date": "2025-01-01", "grant_quantity": 400, "events": {"ipo": "2025-06-15"}} → dates 2025-07-15..2025-10-15, i.e. firing + 1..4 months, never firing + 0.
```

**Details (issue-ready):**

## Summary

When a start can't pin a date but its cadence is known (a partially-settled `LATER OF`, or an unresolved cliff over a pending start), the projection emits symbolic `START_PLUS` installments. `makeStartPlusSchedule` (packages/evaluator/src/evaluate/makeTranches.ts:81-93) builds them with `steps: i * steplength` where `i` runs from 0 — so a 4-occurrence monthly grid reads `start + 0, +1, +2, +3 months`.

Every resolved path in the engine uses the opposite convention: occurrence i lands i periods PAST the anchor, i from 1 (`gridDate`, packages/core/src/kernel.ts:75-83; `evenGrid` at kernel.ts:124 emits `at(idx + 1)`; the unresolved renderer's own resolved-start path, packages/evaluator/src/resolve/unresolved.ts:93, lays `at(i + 1)`). Empirically, `VEST FROM EVENT ipo OVER 4 months EVERY 1 month` with ipo fired 2025-06-15 vests 2025-07-15 / 08-15 / 09-15 / 10-15 — the first tranche is firing **+1 month**, never at the firing.

So the symbolic preview and the eventual resolution disagree by exactly one period on every tranche: the preview says the first tranche vests on the start date itself and the schedule completes at start + (N-1) periods; the engine will actually vest start + 1 .. start + N.

The published `SymbolicDate` type (packages/types/src/evaluation.ts:27, `{ type: "START_PLUS"; unit: PeriodTag; steps: number }`) has no doc stating a 0-based-from-first-vest convention, and there is no renderer that compensates — the MCP server returns `symbolicDate` raw, so an external consumer reading `start + steps unit` gets dates one period early. makeTranches.test.ts:27-43 pins the current 0-based behavior ("steps are index * stepLength"), so this was authored deliberately at the unit level but contradicts the engine's grid semantics at the system level.

## Fix sketch

`steps: (i + 1) * steplength` in makeStartPlusSchedule, updating makeTranches.test.ts (expects 3/6/9 for steplength 3) and unresolved-render.test.ts (48 tranches, steps 1..48 months). Alternatively define and document START_PLUS as "periods after the first vest" — but that reading makes `steps: 0` mean "start + one period", which no consumer would guess from the name.


---

**B12** · Provenance: **blind-hunt** (bugs-apps).

## vestlang_resolve_offset returns the grant-date-folded date instead of the resolved date for any expression resolving before grant_date

**Category:** bug · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** apps/mcp-server/src/date-math.ts:116-149 (wraps expr as `VEST FROM <expr>` and reads `evaluateStatement(...).resolution.installments[0].date`); packages/core/src/kernel.ts:218-221 (allocation folds pre-grant dates onto grantDate via foldToGrantDate); packages/types/src/evaluation.ts:330-335 (the fold is documented as a payment overlay, 'not a change to the schedule')

**Why it matters:** A tool whose contract is pure date arithmetic ('Resolve an offset expression to a concrete date') silently substitutes the grant date for the true answer whenever the expression lands pre-grant — `DATE 2024-01-01` with grant_date 2025-06-01 returns 2025-06-01, and `EVENT ipo - 6 months` (= 2025-03-30) also returns 2025-06-01, with `ok: true` and no hint of the rewrite.

**Remedy:** Resolve the anchor expression directly instead of through the statement/installment path: parse `VEST FROM <expr>`, extract `vesting_start` (the evaluator's `reparseDefinition` in resolve/rehydrate.ts:53-67 already does exactly this), and call `evaluateVestingNodeExpr` — no allocation, no grant-date fold. Add a date-math test with a pre-grant resolution (apps/mcp-server/tests/date-math.test.ts has none).

**Repro:**
```
mcp__vestlang__vestlang_resolve_offset {"expr":"EVENT ipo - 6 months","grant_date":"2025-06-01","events":{"ipo":"2025-09-30"}}  →  {"ok":true,"date":"2025-06-01"} (expected 2025-03-30). Also {"expr":"DATE 2024-01-01","grant_date":"2025-06-01"} → 2025-06-01.
```

**Details (issue-ready):**

## Summary

`vestlang_resolve_offset` is implemented by wrapping the expression as a zero-length schedule (`VEST FROM <expr>`) and reading the sole installment's date (apps/mcp-server/src/date-math.ts:116-149). That reuses the parser and evaluator — good — but the installment path also applies the **grant-date payment fold**: amounts dated before grantDate aggregate onto grantDate (packages/core/src/kernel.ts:218-221, foldToGrantDate). So any expression that resolves before `grant_date` comes back as `grant_date` with `ok: true`.

Verified on the live MCP server (and the fresh dist build):
- `{expr: "DATE 2024-01-01", grant_date: "2025-06-01"}` → `2025-06-01`
- `{expr: "DATE 2025-01-01 - 2 days", grant_date: "2025-06-01"}` → `2025-06-01`
- `{expr: "EVENT ipo - 6 months", grant_date: "2025-06-01", events: {ipo: "2025-09-30"}}` → `2025-06-01` (true answer 2025-03-30)

## Why it matters

The tool's own docstring says it returns "the resolved start" and the type comment at packages/types/src/evaluation.ts:330-335 is explicit that the grant-date fold is a *payment overlay*, not a change to the schedule's dates. A date-math tool answering "what is EVENT ipo - 6 months?" with the grant date is simply a wrong answer, and `ok: true` gives no signal. It also makes the tool inconsistent with `rehydrate`, which computes synthetic witnesses through `evaluateVestingNodeExpr` and happily produces pre-grant witness dates.

## Fix sketch

Replace the installment read with direct node resolution:

1. `parseToProgram("VEST FROM " + expr)`, take `program[0].expr.vesting_start` (mirror `reparseDefinition`, packages/evaluator/src/resolve/rehydrate.ts:53-67 — consider exporting/reusing it);
2. `evaluateVestingNodeExpr(node, ctx)`; `PICKED`+`RESOLVED` → that date, otherwise the existing unresolved error path.

This also removes the dummy `grantQuantity: 1` / installment plumbing.

## Test gap

apps/mcp-server/tests/date-math.test.ts resolve_offset cases all resolve on/after grant_date; none exercises a pre-grant resolution.


---

**B13** · Provenance: **blind-hunt × 3** (duplication, abstraction, bugs-apps) — three independent discoveries; also the one violator of the #103 foldBlocker SSOT.

## vestlang_resolve_offset's hand-rolled blocker walk misses selector-nested events, so the tool's own documented example gets a useless error

**Category:** bug · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** apps/mcp-server/src/date-math.ts:152-177 (first?.unresolved ?? blockerSummary(blockers); blockerSummary reads only top-level blockers via unknown casts); packages/evaluator/src/evaluate/blockerTree.ts:14-22 (foldBlocker, the SSOT for blocker-tree edges, not exported from packages/evaluator/src/index.ts:1-25); apps/mcp-server/src/server.ts:609 (the tool description lists 'EARLIER OF (EVENT a, EVENT b)' as an example)

**Why it matters:** For any selector/gated expression with unfired events, resolveOffset returns the generic 'expression not fully resolvable' instead of naming the missing events — the only actionable piece of information. The cause is a parallel, non-recursive re-implementation of blocker classification that never met the evaluator's foldBlocker.

**Remedy:** Export a small recursive helper from the evaluator (e.g. pendingEventIds(blockers): string[] built on foldBlocker, or re-export foldBlocker) and have resolveOffset use it instead of blockerSummary. Bonus: when the resolution lands on the template arm with a synthetic event, the sourceMap definition is available to echo back.

**Repro:**
```
mcp__vestlang__vestlang_resolve_offset {"expr": "EARLIER OF (EVENT a, EVENT b)", "grant_date": "2025-01-01"}
```

**Details (issue-ready):**

## What happens

`vestlang_resolve_offset` with `expr = "EARLIER OF (EVENT a, EVENT b)"` (the exact example given in the tool's own description, apps/mcp-server/src/server.ts:609) and no events map returns:

```json
{"ok":false,"error":"Expression is unresolved: expression not fully resolvable","unresolved":"expression not fully resolvable"}
```

The useful answer — "event(s) not provided: a, b" — is what the code *tries* to produce, and does produce for a bare `EVENT ipo` or `EVENT ipo + 6 months`.

## Why

`resolveOffset` (apps/mcp-server/src/date-math.ts:116-159) wraps the expression as `VEST FROM <expr>` and evaluates it. A combinator-over-events start lowers to a SYNTHETIC_EVENT and the resolution lands on the **template** arm with `installments: []` and blockers `[{type:"UNRESOLVED_SELECTOR", selector:"EARLIER_OF", blockers:[{type:"EVENT_NOT_YET_OCCURRED", event:"a"}, {event:"b"}]}]` (verified by running the current dist directly with node — matches the live MCP output, so this is not server staleness). With no installment to read `unresolved` off, the message falls to `blockerSummary` (date-math.ts:161-177), which:

- walks **only the top level** of the blocker list (no recursion into `UNRESOLVED_SELECTOR.blockers`), and
- casts each blocker to `{ type?: string; event?: string }` from `unknown[]` instead of using the typed `Blocker` union.

The evaluator already owns the single source of truth for blocker-tree edges: `foldBlocker` in packages/evaluator/src/evaluate/blockerTree.ts:5-22 (consolidated in #103, used by blockerToString/#185, withBoundary, and collectAbsences). It just isn't exported (packages/evaluator/src/index.ts exports only the evaluate + persistence surfaces after #200), so the MCP server hand-rolled a second, broken walk.

## Fix sketch

Export a typed helper from the evaluator — e.g. `pendingEventIds(blockers: Blocker[]): string[]` built on `foldBlocker` (filtering the vestingStart placeholder like `collectAbsences` does) — and replace `blockerSummary` with it. Then any expression shape (selector, gate, nested) lists its missing events. Optionally include the synthetic-event definition from the template arm's `sourceMap` in the message.


---

**B14** · Provenance: **blind-hunt** (bugs-semantics).

## Gated event cliff loses its EVENT identity: interchange reason claims the schedule "can't be stored ahead of time" when it can never be stored at all

**Category:** bug · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/src/resolve/cliff.ts:147-157 (anchored path: isGatedNode → gateVerdict returns UNRESOLVED whenever the base event is unfired, so the EVENT record state is unreachable for an unfired gated event cliff) and cliff.ts:307-318 (deferred path likewise routes a gated event cliff to the gate verdict, never EVENT); packages/evaluator/src/resolve/interchange.ts:48-64 (unresolvedReason scans for cliff.state === "EVENT" first, finds UNRESOLVED instead, falls to DEFERRED_CLIFF); interchange.ts:35-39 (comment asserting an event cliff "always lands here" at EVENT_CLIFF — false for a gated one).

**Why it matters:** An event-anchored cliff has no schema home regardless of firings — EVENT_CLIFF is the structural, permanent cause — but a gated event cliff is reported as DEFERRED_CLIFF, whose rendered message ("The cliff can only be placed once an event fires, so the schedule can't be stored ahead of time") wrongly implies the schedule becomes storable after the firing. It never does: the same schedule with the event fired classifies events-only with reason EVENT_CLIFF, so the two verdicts name different causes for the same structural fact.

**Remedy:** In unresolvedReason (or in lowerCliff/lowerDeferredCliff), detect the event base before/independently of the gate: if eventBaseId(cliffExpr) is set, report EVENT_CLIFF even when the gate verdict carried the routing (e.g. have gateVerdict-returning paths preserve the eventId on the UNRESOLVED record, or scan the original cliff expression in unresolvedReason). Fix the interchange.ts:35-39 comment accordingly.

**Repro:**
```
vestlang_evaluate {"dsl": "VEST OVER 48 months EVERY 1 month CLIFF EVENT ipo AFTER DATE 2025-01-01", "grant_date": "2024-01-01", "grant_quantity": 48}
```

**Details (issue-ready):**

## Summary

For `CLIFF EVENT ipo AFTER DATE 2025-01-01` (ipo unfired), the interchange verdict is `unrepresentable` with reason kind DEFERRED_CLIFF, rendered as "The cliff can only be placed once an event fires, so the schedule can't be stored ahead of time." For the ungated `CLIFF EVENT ipo`, the same verdict carries EVENT_CLIFF: "Event-anchored cliff on \"ipo\" has no template form." The second message is the truth in both cases — an event-anchored cliff has no canonical representation whether or not it has fired, and whether or not it is gated.

## Mechanism

`lowerCliff` (cliff.ts:147-157) checks `isGatedNode(cliffExpr)` before returning the EVENT record. `gateVerdict` (cliff.ts:70-88) treats any pending blocker as "gate pending" — but with an unfired base event the resolution is UNRESOLVED regardless of the gate (the comparison needs the firing date, see constraint.ts:117-127), so an unfired gated event cliff always exits via gateVerdict as `{state: "UNRESOLVED"}` and never reaches `{state: "EVENT", eventId}`. `lowerDeferredCliff` (cliff.ts:300-318) has the same shape: `if (evId && !gated) return EVENT`, gated → gate verdict.

`unresolvedReason` (interchange.ts:48-64) then finds no EVENT-state cliff, sees an UNRESOLVED cliff, and reports DEFERRED_CLIFF. The in-code claim at interchange.ts:35-39 — "blind to firings an event cliff always reads unfired, so it always lands here" (i.e. at EVENT_CLIFF) — is false for the gated case.

Consequence beyond the message: the same schedule's *resolution* verdict, once ipo fires with the gate satisfied, routes to events-only with reason EVENT_CLIFF (buildTemplate, lower.ts:572-575). So a consumer comparing the two verdicts sees the interchange call the obstacle a deferred cliff while the resolution calls it an event cliff — for one schedule whose obstacle never changes kind.

Routing/verdict statuses are unaffected (unrepresentable either way); this is a structured-reason and disclosure mislabel.

## Repro

```
vestlang_evaluate
dsl: VEST OVER 48 months EVERY 1 month CLIFF EVENT ipo AFTER DATE 2025-01-01
grant_date: 2024-01-01, grant_quantity: 48, events: {}
```
Actual: `interchange.reason` = "The cliff can only be placed once an event fires…". Expected: the EVENT_CLIFF reason ("Event-anchored cliff on \"ipo\" has no template form."), as the ungated variant reports.

## Fix sketch

Make the EVENT-ness survive the gate: either carry `eventId` on the UNRESOLVED cliff record when the lowered expression has an event base, and have `unresolvedReason` prefer it; or have `unresolvedReason` re-derive `eventBaseId` from the statement's cliff expression. Update the interchange.ts comment.


---

**B15** · Provenance: **blind-hunt** (bugs-apps).

## vestlang_rehydrate files IMPOSSIBLE_CONDITION blockers under `pending`, presenting permanently-dead synthetic events as still-waiting

**Category:** bug · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** apps/mcp-server/src/persist.ts:280-284 (`pending: result.blockers` wholesale); packages/evaluator/src/resolve/rehydrate.ts:69-75,119-123 (blockersOf returns unresolved AND impossible blockers into one list); tool description at apps/mcp-server/src/server.ts:492 ('pending — synthetic events whose definitions still don't resolve (their gating events haven't fired)')

**Why it matters:** When a gate re-resolves to impossible (e.g. the event fired outside its window), the rehydrate output's only signal is an IMPOSSIBLE_CONDITION blocker inside a field the contract defines as 'gating events haven't fired' — an operator (or LLM client following the description) reads 'keep waiting' for a schedule that can never fire.

**Remedy:** Split the blocker list by kind at the output boundary: `pending` for UNRESOLVED_* blockers, a new `impossible` (or `dead`) array for IMPOSSIBLE_* ones, and update the tool description. The types already discriminate (packages/types/src/evaluation.ts:35-67).

**Repro:**
```
mcp__vestlang__vestlang_persist {"dsl":"VEST FROM EVENT ipo AFTER DATE 2026-01-01 AND BEFORE DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS","grant_date":"2025-01-01","grant_quantity":4800}; then vestlang_rehydrate with that artifact and {"events":{"ipo":"2026-06-01"},"as_of":"2026-07-01"} → firings_to_apply: [], pending: [IMPOSSIBLE_CONDITION …], projection: [].
```

**Details (issue-ready):**

## Summary

`runRehydrate` returns `pending: result.blockers` (apps/mcp-server/src/persist.ts:280-284). The evaluator's `rehydrate` collects blockers from every synthetic definition that didn't resolve (packages/evaluator/src/resolve/rehydrate.ts:119-123), and `blockersOf` (rehydrate.ts:69-75) folds **impossible** results into the same list as unresolved ones.

The tool contract (apps/mcp-server/src/server.ts:492) defines `pending` as "synthetic events whose definitions still don't resolve (their gating events haven't fired)". But a definition can fail to resolve because it is now **impossible** — e.g. a windowed gate whose event fired outside the window. Reproduced: persisting `VEST FROM EVENT ipo AFTER DATE 2026-01-01 AND BEFORE DATE 2025-01-01 …` and rehydrating with `ipo: 2026-06-01` yields `pending: [{type: "IMPOSSIBLE_CONDITION", …}]`.

An operator following the contract keeps the grant in a waiting state forever; the structured blocker type is the only tell, and the field name actively contradicts it.

## Fix sketch

The blocker union is already discriminated (UnresolvedBlocker vs ImpossibleBlocker, packages/types/src/evaluation.ts:35-67). Partition at the MCP boundary:

```ts
const impossible = result.blockers.filter(b => b.type.startsWith("IMPOSSIBLE"));
const pending = result.blockers.filter(b => !b.type.startsWith("IMPOSSIBLE"));
```

(or match on the union members explicitly), return both arrays, and amend the tool description so clients know a non-empty `impossible` means 'stop waiting; this arm is dead'.


---

**B16** · Provenance: **blind-hunt** (bugs-apps).

## vestlang_rehydrate throws a raw parser error (not a structured tool error) on a malformed sidecar definition; artifact dates are regex-checked only

**Category:** bug · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/src/resolve/rehydrate.ts:53-67 (reparseDefinition lets peggy SyntaxError propagate); apps/mcp-server/src/persist.ts:246-285 (runRehydrate has no try/catch, unlike runPersist at 168-176); apps/mcp-server/src/server.ts:525-535 (handler does not catch either); apps/mcp-server/src/persist.ts:39-41 (persist-module ISO_DATE lacks the isValidCalendarDate refinement that server.ts:84-87 applies elsewhere)

**Why it matters:** The artifact is caller-supplied input (the schema explicitly anticipates externally stored/edited artifacts); a corrupted sidecar definition string surfaces as an uncaught peggy 'Expected "DATE", "EARLIER", …' message with no indication it came from artifact.sidecar, breaking the server's own contract that failures come back structured ('When parse/compile/evaluate fail they don't throw'), and a non-calendar date like 2025-02-31 in artifact.runtime passes zod and only dies deep in core.

**Remedy:** Wrap runRehydrate's body (or at least reparseDefinition per entry) and return a structured error naming the offending sidecar event_id; add `.refine(isValidCalendarDate, …)` to the persist-module ISO_DATE as server.ts already does for every other date input.

**Repro:**
```
mcp__vestlang__vestlang_rehydrate {"artifact":{"template":{"id":"x","statements":[{"order":1,"vesting_base":{"type":"EVENT","event_id":"evt_1"},"occurrences":1,"period":0,"period_type":"DAYS","percentage":{"numerator":1,"denominator":1}}]},"runtime":{"grantDate":"2025-01-01"},"sidecar":{"vestlang":{"evt_1":{"definition":"TOTALLY NOT DSL (("}}}},"grant_date":"2025-01-01","grant_quantity":100}
```

**Details (issue-ready):**

## Summary

Two input-hardening gaps in the rehydrate path, both at the boundary where the *caller's stored artifact* re-enters the engine:

1. **Malformed sidecar definition → raw throw.** `reparseDefinition` (packages/evaluator/src/resolve/rehydrate.ts:53-67) parses `"VEST FROM " + definition` and lets the peggy SyntaxError propagate. `runRehydrate` (apps/mcp-server/src/persist.ts:246-285) and the tool handler (server.ts:525-535) have no try/catch — verified: a definition of `"TOTALLY NOT DSL (("` throws `Expected "DATE", "EARLIER", "EVENT", …` straight out of runRehydrate. The MCP SDK converts handler throws into a generic isError text, but the message neither names the sidecar entry nor matches the structured `{error: {ruleId, message}}` convention the server's instructions promise (server.ts:74-78). `runPersist` by contrast wraps its evaluate call (persist.ts:168-176).

2. **Persist-module dates skip calendar validation.** The shared `ISO_DATE` in server.ts (84-87) refines with `isValidCalendarDate`; the artifact schema's own `ISO_DATE` (persist.ts:39-41) is regex-only, so `runtime.startDate: "2025-02-31"` or a firing dated `"2025-13-01"`-adjacent shapes like `2025-02-31` pass zod and fail later inside core's runtime assertions (or worse, feed date math before validation).

## Fix sketch

- Wrap the sourceMap re-resolution per entry; on parse failure return/append a structured error naming `event_id` and the bad definition (these definitions are vestlang-render output, so a failure genuinely means corruption — worth saying so).
- Reuse the refined ISO_DATE (export it from server.ts or a shared module) in persist.ts.
- Test: rehydrate with a corrupted sidecar; rehydrate with an invalid calendar date in runtime.


---

**B17** · Provenance: **blind-hunt** (bugs-dates).

## CLI --event accepts impossible calendar dates (regex-only), which then silently roll over in core's date math (or surface as a deep 'Invalid VestingRuntime' throw)

**Category:** bug · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** apps/cli/src/index.ts:92-104 (parseEvent validates only /^([^=]+)=(\d{4}-\d{2}-\d{2})$/ — no isValidCalendarDate, unlike grantDate which goes through validateDate at apps/cli/src/evaluate.ts:21); packages/pipeline/src/validate.ts:4-5 claims boundary parity with the MCP server ("same rules, different mechanism") but only grant_date/as_of get it; the rollover: packages/core/src/dates.ts:37-40 (toDate does no calendar validation — utcMidnight rolls 2025-02-31 to 2025-03-03) reached via packages/evaluator/src/evaluate/vestingNode/vestingBase.ts:76,89-102 (event date read from ctx.events and stepped through applyOffsets).

**Why it matters:** A fat-fingered `--event ipo=2025-02-31` on a `FROM EVENT ipo + 1 month` schedule yields a silently wrong projection (anchor rolled to Mar 3, grid laid from Apr 3) with no diagnostic; on a bare `FROM EVENT ipo` it instead dies with an internal-looking 'Invalid VestingRuntime' error thrown from core's compile — both are boundary failures the CLI's own validate.ts comment promises don't exist.

**Remedy:** Run each parsed --event date through isValidCalendarDate in parseEvent (apps/cli/src/index.ts), matching the MCP server's zod refine (apps/mcp-server/src/server.ts:86-87) and the validateDate treatment of grant/as-of dates. Optionally also guard ctx.events/grantDate/asOf once in createEvaluationContext so programmatic @vestlang/evaluator callers get the same boundary instead of toDate's silent rollover.

**Details (issue-ready):**

## Summary

The CLI parses repeatable `--event NAME=YYYY-MM-DD` flags with a shape-only regex (apps/cli/src/index.ts:96): `2025-02-31` and `2025-13-01` pass. The grant date on the same command line is calendar-validated (`validateDate` → `isValidCalendarDate`), and pipeline/validate.ts:4-5 explicitly claims the CLI and MCP boundaries enforce "same rules, different mechanism" — the MCP server's ISO_DATE zod schema refines with isValidCalendarDate (apps/mcp-server/src/server.ts:86-87), so the parity claim is broken exactly for event dates.

## Downstream behavior (why it's not just cosmetic)

core's `toDate` (packages/core/src/dates.ts:37-40) intentionally does no validation — `setUTCFullYear(2025, 1, 31)` rolls to 2025-03-03. Two distinct failure modes follow:

1. `FROM EVENT ipo + 1 month` (or any offsets/grid stepping): `applyOffsets` (packages/evaluator/src/evaluate/vestingNode/vestingBase.ts:89-102) steps the bogus string through addMonthsRule, producing a rolled-over, perfectly-valid-looking resolved date; the start externalizes as a synthetic event whose recorded firing is the rolled date, core's runtime validation passes, and the user gets a silently wrong schedule.
2. Bare `FROM EVENT ipo`: the raw string rides into `runtime.eventFirings` verbatim; `assertValidVestingRuntime` inside `compileRaw` (packages/core/src/compile.ts:154) rejects it and the CLI prints a deep `Invalid VestingRuntime: eventFirings[0].date must be a real calendar date` — correct but worded as an engine internal rather than a flag error. The events-only arm doesn't run that validator at all, so multi-grid programs take path (1).

## Fix sketch

Validate in `parseEvent` with `isValidCalendarDate` and raise `InvalidArgumentError` (one line plus a test). Consider also asserting calendar validity of `grantDate` / `events` / `asOf` once in `createEvaluationContext` (packages/evaluator/src/utils.ts:15-23), so the published evaluator API fails loudly at its own boundary instead of relying on every front-end to remember — core already models this stance for its own inputs (packages/core/src/validate.ts:237, "2025-02-31 is rejected, not rolled").


---

**B18** · Provenance: **blind-hunt** (bugs-apps).

## CLI `lint` exit code disagrees between text and markdown modes on warning-only results (and is the only command outside the error boundary)

**Category:** bug · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** apps/cli/src/lint.ts:81 (text mode: `process.exit(diagnostics.length ? 1 : 0)` — any warning exits 1) vs apps/cli/src/lint.ts:74 (markdown mode: exits 1 only when `severity === "error"`); apps/cli/src/index.ts:144-151 (lint action invoked without `withBoundary`, unlike every other command at index.ts:36-37,50-51,82-83,128-129)

**Why it matters:** The same warning-only program (`1/3 VEST …`, under-allocation warning) makes `vest lint "<dsl>"` exit 1 but `vest lint --markdown file.md` exit 0 (verified), so any script or pre-commit hook keying off the exit code behaves differently depending on input mode; and an unexpected throw inside lintText escapes as a raw stack trace because lint skips the one error boundary the CLI built for exactly that.

**Remedy:** Align text mode to error-severity gating (`diagnostics.some(d => d.severity === "error") ? 1 : 0`), or document/flag warning-strictness explicitly; wrap the lint action in `withBoundary` like every other command. Add the CLI's first tests around exit codes (apps/cli has none).

**Details (issue-ready):**

## Summary

Two small but user-visible inconsistencies in `vest lint`:

1. **Exit-code semantics differ by mode.** Text mode exits non-zero on *any* diagnostic (apps/cli/src/lint.ts:81), markdown mode only on error severity (lint.ts:74). Verified: `vest lint "1/3 VEST FROM DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS"` (warning:portion-allocation only) exits **1**, while the same statement in a ```vest block via `--markdown` exits **0**. Editors/hooks keying on the exit code get contradictory signals for identical content.

2. **lint is the only command not wrapped in `withBoundary`.** apps/cli/src/index.ts:144-151 calls `lint(parts, opts)` bare, while inspect/compile/asOf/evaluate all route through the boundary that converts stray throws into one `error:` line (index.ts:17-24, whose comment says it exists so a bug "never" leaks a raw Node stack trace). A throw out of `lintText`/`lintMarkdown` would leak a stack with internal paths.

## Fix sketch

- Pick one exit policy (error-severity gating matches the markdown mode and most linters' default) and apply it to both branches.
- Wrap the lint action in `withBoundary`.
- apps/cli currently has zero tests; exit-code behavior of `lint` (and `evaluate`/`asOf` failure paths) is the highest-value place to start, since it's the part scripts depend on.


---

**B19** · Provenance: **blind-hunt** (bugs-allocation).

## Template-recovery detour throws on extreme grants instead of degrading, replacing the over-allocation finding with a bare evaluation error

**Category:** bug · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/recover/src/recover.ts:23-96 (evaluateProgramWithRecovery has no guard around the rescue detour; recover.ts:54-57 inferSchedule, recover.ts:65 re-evaluateProgram); packages/evaluator/src/resolve/lower.ts:50-55 (amountToFraction → fracReduce on quantity/totalShares); packages/utils/src/fractions.ts:32-44 (toFraction throws when a reduced component exceeds Number.MAX_SAFE_INTEGER); packages/pipeline/src/run.ts:117-119 (runEvaluate converts the throw into a single evaluation-error, discarding the already-computed schedule)

**Why it matters:** An over-allocating events-only program at a large-but-valid grant quantity gets a correct primary evaluation (verdict + over-allocation finding) and then loses it: the optional rescue detour re-evaluates the inferred over-allocated QUANTITY (e.g. 13510798882111486 shares of a 9007199254740991 grant), the fraction reducer throws, and the whole tool returns a generic error instead of the diagnosis.

**Remedy:** Wrap the rescue detour (everything after computing `noRescue` in evaluateProgramWithRecovery) in try/catch and return `noRescue` on any throw — matching the degradation policy clauseBreakdown already uses (run.ts:74-76). Optionally also skip recovery outright when the schedule carries an error-severity over-allocation finding, since rescuing an invalid projection into a `template` status is of questionable value anyway.

**Repro:**
```
mcp__vestlang__vestlang_evaluate {"dsl":"3/4 VEST OVER 2 months EVERY 1 month PLUS 3/4 VEST OVER 2 months EVERY 1 month","grant_date":"2024-01-01","grant_quantity":9007199254740991}
```

**Details (issue-ready):**

## Summary

`runEvaluate` routes every evaluation through `evaluateProgramWithRecovery` (pipeline/run.ts:98). When the primary collapse classifies events-only, the detour infers a single-statement DSL from the realized projection and re-evaluates it (recover/recover.ts:54-65). For an over-allocating program the projection totals more than the grant, so the inferred DSL is an over-grant QUANTITY (`150 VEST ...` at grant 100 — observable in the `recovered` block). At extreme grant sizes that quantity's lowering `fracReduce(quantity/totalShares)` (resolve/lower.ts:50-55) trips utils' deliberate overflow refusal (fractions.ts:37-42) and the unguarded detour throws, which run.ts:117-119 converts into the entire tool result.

## Repro

```
vestlang_evaluate dsl: "3/4 VEST OVER 2 months EVERY 1 month PLUS 3/4 VEST OVER 2 months EVERY 1 month"
grant_date: 2024-01-01, grant_quantity: 9007199254740991
```

Returns `{"error":{"ruleId":"evaluation-error","message":"fraction component exceeds Number.MAX_SAFE_INTEGER after reduction (13510798882111486/9007199254740991); ..."}}`. The same DSL at grant 100 returns the full answer: verdict, installments, `valid: false`, and the over-allocation finding. Stack confirmed against the built packages: toFraction ← fracReduce ← amountToFraction ← resolveNonChained ← resolveStatements, reached from inside evaluateProgramWithRecovery — the primary evaluation of the authored program succeeds (its fractions are small; conservation at MAX_SAFE verified separately: thirds of 9007199254740991 emit 3002399751580330+3002399751580330+3002399751580331 exactly).

## Why it matters

The rescue is documented as transparent and optional ("cheap-first ... at most one inferSchedule + one re-classify", recover.ts:19-22). An optional enhancement should never be able to sink a result that was already computed. The blast radius is the extreme-grant × over-allocation corner, but the failure mode is precisely the one #204's BigInt work was meant to close off: the loud overflow refusal is doing its job in utils, and recovery turns it into a regression of the findings channel.

## Suggested fix

In `evaluateProgramWithRecovery`, wrap the detour (the code after `noRescue` is built) in try/catch → `return noRescue`. This matches `clauseBreakdown`'s existing degrade-don't-sink policy (pipeline/run.ts:66-77). Consider additionally gating recovery on the absence of an error-severity finding.


---

**B20** · Provenance: **differential + blind-hunt × 2** (test-adequacy, bugs-semantics) — one root cause (independent per-statement floors vs the collapsed allocator's single telescoping cumulative), two manifestations: the as-of unresolved tally (first writeup) and the per-clause breakdown (second).

## #176's per-statement floor claims break cross-statement share conservation — `unresolved` understates by up to n−1 shares vs what the allocator will eventually deliver

**Category:** differential · **Confidence:** medium · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/src/utils.ts:29-36 (amountToQuantify floors each statement independently); packages/evaluator/src/asof.ts:93-98 (program fallback quantity = Σ per-statement floors); packages/evaluator/src/resolve/unresolved.ts:48 (symbolic installments sized from the same per-statement floor). For three 1/3 portions of a 100-share grant: floor×3 = 99, while the joint allocator (single running cumulative, packages/core/src/kernel.ts:205-216) telescopes to exactly 100 once the events fire.

**Why it matters:** The engine's headline contract is exact integer allocation that telescopes to the grant; the symbolic/pending side now reports totals that disagree with the resolved side by up to one share per statement (observed: `unresolved: 99`, `total_unvested: 99` for a fully-pending 100-share grant), so 'unvested + vested' can never reconcile to the grant while anything is pending.

**Remedy:** Size program-level pending quantity from the summed fraction, not summed floors: in evaluateProgramAsOf compute `floorSharesAt(grantQuantity, fracSum(percentages))`, and in partitionAsOf reconcile the unresolved tally against (grant × total claimed fraction − resolved shares) rather than summing per-installment claims. Per-installment symbolic amounts can keep the per-statement floor (they're individually provisional), but the published totals should telescope. Add a conservation test: vested + unvested(total) === floorSharesAt(grant, Σ portions) for pending programs.

**Repro:**
```
mcp__vestlang__vestlang_evaluate_as_of {"dsl": "1/3 VEST FROM EVENT a OVER 1 month EVERY 1 month PLUS 1/3 VEST FROM EVENT b OVER 1 month EVERY 1 month PLUS 1/3 VEST FROM EVENT c OVER 1 month EVERY 1 month", "grant_date": "2024-01-01", "grant_quantity": 100, "as_of": "2026-01-01"} → unresolved: 99, total_unvested: 99 (grant is 100; once a/b/c fire the allocator vests exactly 100)
```

**Details (issue-ready):**

## Symbolic share claims don't telescope across statements

PR #176 (6f0f20f) fixed round-1 B6 by replacing float portion math with `floorSharesAt(grantQuantity, portion)` per statement (packages/evaluator/src/utils.ts:29-36). That eliminated the BigInt crash and the fractional leaks — confirmed fixed empirically — but the chosen claim is a **per-statement** floor, and per-statement floors don't sum to the cumulative round-down the resolved path uses: `allocateEvents` runs one cumulative across all statements and telescopes to the grant exactly (packages/core/src/kernel.ts:205-216).

Consequences on the current tree (all empirically confirmed):
- `evaluateProgramAsOf`'s nothing-scheduled fallback sums per-statement floors (packages/evaluator/src/asof.ts:93-98): three pending 1/3 portions of 100 report `unresolved: 99` / `total_unvested: 99`. When the three events fire, the same program vests exactly 100 — the pending-side number was wrong by 1.
- The symbolic installments emitted by the unresolved/events arms are sized the same way (packages/evaluator/src/resolve/unresolved.ts:48 + allocateVector), so any partition over a mixed stream inherits the same shortfall.

Round-1 B6's remedy asked for "an integer claim **consistent with cumulative round-down**"; the per-statement floor satisfies that within one statement but not across statements. The exact eventual allocation across statements isn't knowable symbolically (it depends on date interleaving), but the **total** is: `floorSharesAt(grant, fracSum(portions))`.

**Fix sketch.** Keep per-installment symbolic amounts as-is, but compute published totals from the summed fraction: the asof fallback becomes `floorSharesAt(grantQuantity, fracSum(program portions))`, and `partitionAsOf` reconciles `unresolved` as (program total claim − resolved-or-impossible shares) instead of summing per-installment claims. Tag the remainder onto the last symbolic installment or report it only in the tally. Add a conservation invariant test over pending→fired transitions.

Low practical stakes (≤ n−1 shares) but it's a visible violation of the engine's central telescoping promise, on the same numbers (`unresolved`, `total_unvested`) finding 1 makes prominent — worth fixing together.


## Per-clause breakdown does not sum to the collapsed schedule: each clause is re-floored independently, losing shares

**Category:** differential · **Confidence:** medium · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/src/evaluate/index.ts:62-73 (evaluateClauseGroups resolves each chain group alone via resolveToCore(chain), each against the full grant); packages/pipeline/src/run.ts:62-77 (clauseBreakdown is "a second resolution pass, separate from the collapse"); packages/core/src/kernel.ts:193-216 (the collapsed allocation's single running cumulative telescopes to totalShares only across the whole program — per-clause runs floor independently).

**Why it matters:** For `1/3 … PLUS 2/3 …` of 100 shares the collapsed schedule allocates 50+50=100, but the breakdown attributes 33 (16+17) to clause 1 and 66 (33+33) to clause 2 — 99 of 100. A consumer using the breakdown for attribution (its stated purpose) cannot reconcile it with the schedule it is attributing; one share belongs to no clause.

**Remedy:** Derive the breakdown from the collapsed allocation instead of re-evaluating each clause against the grant: core's RawEvent already carries statementOrder through allocateEvents, so the single cumulative allocation can be partitioned per statement/chain-group post hoc, guaranteeing the per-clause amounts sum to the collapsed amounts. Alternatively document the discrepancy explicitly on ClauseBreakdown and the MCP tool description (today it says "that clause's own installments" without warning that totals don't reconcile).

**Repro:**
```
vestlang_evaluate {"dsl": "1/3 VEST OVER 2 months EVERY 1 month PLUS 2/3 VEST FROM DATE 2024-01-01 OVER 2 months EVERY 1 month", "grant_date": "2024-01-01", "grant_quantity": 100}
```

**Details (issue-ready):**

## Summary

`vestlang_evaluate` returns a collapsed schedule plus a per-clause `breakdown`. The breakdown is produced by `evaluateClauseGroups` (evaluate/index.ts:62-73), which runs `resolveToCore([chain])` per chain group — i.e. each clause is allocated against the full grant on its own cumulative. Floor-rounding then loses shares relative to the collapsed run, where the single cumulative telescopes across statements.

## Repro

```
vestlang_evaluate
dsl: 1/3 VEST OVER 2 months EVERY 1 month PLUS 2/3 VEST FROM DATE 2024-01-01 OVER 2 months EVERY 1 month
grant_date: 2024-01-01, grant_quantity: 100
```
Actual: collapsed installments `[50 @ 2024-02-01, 50 @ 2024-03-01]` (sum 100); breakdown clause 1 = `[16, 17]` (33), clause 2 = `[33, 33]` (66); breakdown total 99.

## Notes

The per-clause floors are individually consistent with `amountToQuantify`'s floor convention (utils.ts:29-36), so this is not a rounding *error* in either pass — it is the structural consequence of running attribution as an independent second evaluation (run.ts:62-65 says as much). But the brief consumer-facing contract ("which clause produced what") implies the parts explain the whole, and today they don't: one share is produced by no clause. The same mechanism can also disagree on *dates* in principle (a clause evaluated alone loses cross-statement allocation order ties), though I did not observe that.

## Fix sketch

Partition the collapsed allocation by statementOrder (already threaded through core's RawEvent sort, kernel.ts:198-203) and map statement → chain group, so the breakdown is a re-grouping of the one allocation rather than a second one. Degradation behavior (run.ts:74-76 catch → empty breakdown) can stay.


---

**B21** · Provenance: **blind-hunt** (bugs-dates).

## Numeric day-of-month policies retarget anchor offsets, not just grid dates: 'DATE 2025-01-10 + 1 month' under rule '15' starts on Feb 15, and a '+30 days' spelling of the same intent does not snap

**Category:** differential · **Confidence:** medium · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/src/evaluate/vestingNode/vestingBase.ts:96-99 (applyOffsets routes MONTHS offsets through addMonthsRule with ctx.vesting_day_of_month, DAYS offsets through addDays); packages/core/src/dates.ts:96-113 (numeric policies 'target a fixed day regardless' of the date being stepped from); empirically: vestlang_resolve_offset('DATE 2025-01-10 + 1 month', vesting_day_of_month '15') → 2025-02-15, not 2025-02-10.

**Why it matters:** The VestingDayOfMonth policy is documented as the day the GRID vests on (the grant's vesting day), but under a fixed-numeric rule it also moves the vesting START and cliff dates produced by month offsets by up to ~2 weeks — and the displacement depends on whether the author wrote '+1 month' or '+30 days', which is hard to defend as intent.

**Remedy:** Decide and pin the semantics: either apply anchor offsets with the pure keep-day/clamp rule (pass VESTING_START_DAY_OR_LAST_DAY_OF_MONTH or origin=d explicitly in applyOffsets, leaving numeric dom to grid stepping only), or document that ALL month arithmetic — offsets, cliffs, grid — snaps to the policy day, and add a test pinning whichever is chosen.

**Repro:**
```
mcp__vestlang__vestlang_resolve_offset {"expr": "DATE 2025-01-10 + 1 month", "grant_date": "2025-01-01", "vesting_day_of_month": "15"} → {"ok":true,"date":"2025-02-15"} (expected 2025-02-10 under offset-as-duration semantics)
```

**Details (issue-ready):**

## Summary

`applyOffsets` (packages/evaluator/src/evaluate/vestingNode/vestingBase.ts:96-99) steps MONTHS offsets through `addMonthsRule` carrying the evaluation context's `vesting_day_of_month`. Under the default policy that's harmless (origin defaults to the date being stepped, so the day is kept/clamped). Under a fixed-numeric policy ("01"–"28", "29/30/31_OR_LAST"), `addMonthsRule`'s pickDay targets the fixed day regardless of the source day (packages/core/src/dates.ts:110-112), so the offset is no longer a duration: `DATE 2025-01-10 + 1 month` with rule "15" resolves to 2025-02-15. The same intent written `+ 30 days` lands 2025-02-09 — DAYS offsets never see the policy.

This is internally consistent (lowerCliff's measureDuration round-trips with the same dom, and core's compile recomputes cliff dates with the same addPeriod, so template↔projection agree), and it may be the intended reading ("every month-step in this grant lands on the policy day"). But the policy is documented everywhere as the day the GRID vests on — "the day-of-month every MONTHS segment grids on: one vesting day per grant" (packages/core/src/kernel.ts:55-58) — and silently displacing the vesting START (and the cliff date, via the same path: packages/core/src/compile.ts:60-71) is a different, stronger claim. The asymmetry with DAYS offsets makes the resulting dates spelling-dependent.

## Ask

A deliberate decision plus a pinned test. If anchor offsets should be pure durations, applyOffsets should call addMonthsRule with the keep-day default policy (or with origin=d under a policy that honors origin) rather than the grid policy; if the snap is intended, say so in the grammar doc and the VestingDayOfMonth comments so a consumer can predict `resolve_offset` output.


---

**B22** · Provenance: **blind-hunt** (bugs-apps).

## Statically-dead date windows: linter errors (unsatisfiable-date-window), but evaluator calls the schedule a storable template and persist stores it

**Category:** differential · **Confidence:** medium · **Verifier:** confirmed (novel)

**Evidence:** packages/linter/src/rules/unsatisfiable-date-window.ts:6-12,119-135 (error severity, 'the gated node can never resolve'); packages/evaluator/src/resolve/interchange.ts:160-175 (interchange = same lowering against an events-blind context; no static window analysis anywhere in resolve/); apps/mcp-server/src/persist.ts:152-191 (persist never lints, gates only on resolution status)

**Why it matters:** `VEST FROM EVENT ipo AFTER DATE 2026-01-01 AND BEFORE DATE 2025-01-01 …` is flagged error by the linter (#212: no firing date can ever satisfy the gate), yet evaluates to interchange=template / resolution=template (pending) with no firings, and vestlang_persist happily stores it — an artifact whose every possible rehydration is impossible enters the system-of-record lifecycle with zero warnings on that surface.

**Remedy:** Cheapest: have `runPersist` run `lintText(dsl)` and refuse on error-severity diagnostics (it already has the DSL). More principled: teach the evaluator's verdicts the same static window analysis — a gate provably empty over fixed dates is 'impossible no matter what events fire', which is the interchange `impossible` arm's own definition (packages/types/src/evaluation.ts:256-257). Decide which layer owns the check, but today the three surfaces disagree.

**Repro:**
```
mcp__vestlang__vestlang_lint {"dsl":"VEST FROM EVENT ipo AFTER DATE 2026-01-01 AND BEFORE DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS"} → error unsatisfiable-date-window; mcp__vestlang__vestlang_persist with the same dsl + {"grant_date":"2025-01-01","grant_quantity":4800} → ok:true with sidecar evt_1.
```

**Details (issue-ready):**

## Summary

PR #212 added `unsatisfiable-date-window` (error severity): a gate whose BEFORE/AFTER constraints over fixed dates leave an empty window "can never be met, so the gated node can never resolve" (packages/linter/src/rules/unsatisfiable-date-window.ts:6-12).

The evaluator does no equivalent static analysis. For `VEST FROM EVENT ipo AFTER DATE 2026-01-01 AND BEFORE DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS`:
- lint: **error** unsatisfiable-date-window
- evaluate (no firings): interchange=**template**, resolution=**template**, valid=true, pending blockers only
- evaluate (any firing, e.g. ipo=2026-06-01 or 2024-06-01): resolution=**impossible** — confirming the linter: every firing is impossible
- persist: **ok: true**, artifact stored with sidecar definition `EVENT ipo AND(AFTER DATE 2026-01-01, BEFORE DATE 2025-01-01)`
- rehydrate after ipo fires: no firing to apply; the impossibility surfaces only as an `IMPOSSIBLE_CONDITION` blocker filed under `pending` (see companion finding).

For a DATE-anchored start the evaluator *does* return interchange=impossible for the same shape of contradiction, so the inconsistency is specifically the event-anchored gate.

## Discussion

Interchange is computed by re-running the template lowering against an emptied events map (packages/evaluator/src/resolve/interchange.ts:160-175); a gated event start lowers to an opaque synthetic event, so the dead window is invisible to it. Whether interchange *should* say impossible is arguable (the never-fires world is consistent — the grant just never vests), but the practical seam is persist: a program the project's own linter rejects as an error becomes a stored artifact with no warning. Note this is NOT covered by open issue #212's scope (that added the lint rule) nor by the open-issues list.

## Remedy options

1. `runPersist` runs `lintText` and refuses (or returns diagnostics alongside) on error severity — one-line seam, keeps analysis in the linter.
2. Port the window analysis into the evaluator's verdicts so interchange reports `impossible` for provably-dead gates (matches the impossible arm's documented definition at packages/types/src/evaluation.ts:256-257).

Confidence is medium on which remedy is right; the cross-surface disagreement itself is verified high.


---

**B23** · Provenance: **blind-hunt** (bugs-allocation).

## floorSharesAt's safe-Number-cast precondition is documented but never enforced: compile accepts unsafe-integer totalShares and over-1 cumulatives break the stated bound

**Category:** type-model · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/core/src/allocate.ts:16-21 + 37 (doc: "The quotient is bounded by totalShares (safe-integer by precondition), so the Number() cast is safe"; only the denominator is checked at allocate.ts:29-33); packages/core/src/compile.ts:148-152 (compileRaw checks Number.isInteger, not Number.isSafeInteger — Number.isInteger(2**53 + 2) is true); packages/core/src/validate.ts:154-164 (statement percentages > 1 deliberately admitted, so cumulative > 1 makes the quotient exceed totalShares)

**Why it matters:** Both halves of the documented precondition are unenforced: a direct core.compile caller (OCF-Tools is the intended external consumer) can pass totalShares above 2^53 or an over-1 percentage template, and Number(BigInt) then rounds quotients silently — per-installment amounts drift by ±1 with no loud refusal, the opposite of the policy utils' toFraction applies to the same boundary.

**Remedy:** In compileRaw (and floorSharesAt itself, since it is exported and called by the evaluator with ctx.grantQuantity), require Number.isSafeInteger(totalShares); in floorSharesAt, after the BigInt division, refuse loudly if the quotient exceeds MAX_SAFE_INTEGER (mirroring utils/fractions.ts:36-42) instead of letting Number() round.

**Details (issue-ready):**

## Summary

`floorSharesAt` (core/src/allocate.ts:22-38) casts a BigInt quotient back to Number on the strength of two preconditions stated in its doc comment — totalShares is a safe integer, and the cumulative fraction is ≤ 1 so the quotient is bounded by totalShares. Neither is checked anywhere:

1. `compileRaw` validates `Number.isInteger(totalShares) && totalShares >= 0` (compile.ts:148). `Number.isInteger` accepts any representable float integer — 2^53+2, even 1e308 — so totalShares above MAX_SAFE_INTEGER reaches the allocator, where `Number((total*num)/den)` rounds-to-nearest silently for quotients above 2^53.
2. The validator deliberately admits statement percentages > 1 (validate.ts:154-164, over-allocation is "a finding's job"), so a cumulative > 1 is a supported input to the same cast, making the "bounded by totalShares" claim false exactly in the supported over-allocation case. Example: template percentage 3/2 with totalShares 9007199254740990 → floor quotient 13510798882111485 (> 2^53, odd) → Number cast rounds it; emitted amounts shift by ±1 from the exact floors.

The telescoping sum still lands on Number(floor(total×sum)) so the headline total stays consistent, and monotonicity of the cast means amounts can't go negative — the damage is per-installment imprecision without the loud refusal this codebase otherwise insists on (#204's toFraction throws for the analogous condition in utils/fractions.ts:37-42).

## Reachability

Through the DSL/MCP surface this corner is effectively closed off: portions outside [0,1] are rejected at parse, and an over-grant QUANTITY at extreme sizes trips toFraction's loud throw during lowering first (see the recovery-detour finding). The exposure is the direct `@vestlang/core` boundary — exactly the seam shipped for OCF-Tools, which hands compile raw templates that validate.ts intentionally lets carry over-1 percentages. A reference compiler's allocation kernel should not have a silent-rounding mode reachable from validated input.

## Suggested fix

- compileRaw: `Number.isSafeInteger(totalShares)` instead of `Number.isInteger`.
- floorSharesAt: guard the quotient — `if (q > MAX_SAFE) throw` — with the same wording policy as utils' toFraction. (floorSharesAt is also called by the evaluator with raw `ctx.grantQuantity` via amountToQuantify, so the guard belongs in the function, not only in compile's entry.)
- Update the doc comment to state the enforced invariant rather than an assumed one.

Low practical impact (grants near 2^53 shares are absurd), but cheap to enforce and it makes #204's "survive extreme grant sizes" claim actually hold at every seam of the kernel.


---

**B24** · Provenance: **blind-hunt** (bugs-semantics) — low confidence; reachable only via direct core.compile / persist round-trips, not the DSL.

## expandGrid silently discards an explicit fixed cliff percentage when the cliff date precedes the first grid occurrence

**Category:** bug · **Confidence:** low · **Verifier:** confirmed (novel)

**Evidence:** packages/core/src/kernel.ts:144-146 (`if (preCount === 0) return evenGrid();` — runs for `fixed` cliffs with any percentage, discarding the lump entirely) versus kernel.ts:149-162 (the symmetric over-coverage case, a fixed cliff swallowing the whole grid with percentage < 1, throws loudly); packages/core/src/validate.ts:61-90 (validateCliff checks only that percentage ∈ [0,1]; no cross-check between cliff length and the grid).

**Why it matters:** Canonical-template input (the interchange this engine is the reference compiler for) can carry `cliff: {length: 10, period_type: DAYS, percentage: 1/4}` on a monthly grid: the authored intent "25% vests at day 10" is silently recompiled into a flat even grid with no cliff and no error, while the mirror-image inconsistency one branch below is treated as a loud refusal. The DSL can't produce this (lowerCliff pins percentage to m/N and returns NONE when m=0, cliff.ts:213-217), but core.compile is the public storable-template entry point and persist/rehydrate round-trips templates.

**Remedy:** Treat it the same way as the swallowed-grid case: when cliff.kind === "fixed", preCount === 0, and percentage > 0, throw (the lump's percentage has nowhere to come from on this grid) — or reject at validateCliff/assertValidVestingScheduleTemplate where the grid geometry is statically checkable. If a zero-occurrence cliff is instead defined as a no-op, state that in the kernel contract next to the throw it contradicts.

**Details (issue-ready):**

## Summary

`expandGrid` (packages/core/src/kernel.ts:97-183) applies a fixed cliff by folding the occurrences at/before the cliff date into one lump sized by the cliff's own percentage. Two degenerate geometries exist:

1. The cliff covers the *whole* grid (postOccurrences empty) with percentage < 1 → the remainder would vanish → kernel.ts:149-162 throws loudly, with a comment noting only direct template input can get here.
2. The cliff covers *no* occurrence (preCount === 0) with percentage > 0 → the lump would have no occurrences to fold → kernel.ts:144-146 silently returns the plain even grid, discarding the percentage.

Case 2 is the same class of contradictory direct-template input as case 1 (the DSL can't author either: lowerCliff derives percentage = m/N, which is 0 exactly when preCount is 0, cliff.ts:211-217), but it degrades silently instead of refusing. No shares are lost in total — the even grid still vests 100% — but the authored "percentage at the cliff date" is rewritten without a trace, and `validateVestingScheduleTemplate` (validate.ts:61-90, 126-168) accepts the template, so neither compile-time validation nor runtime raises anything.

Confidence is low on intent: one can read the kernel's contract ("a cliff dated on or before the anchor holds nothing back" / "the cliff sits before the first installment → nothing to hold back") as defining the no-op. But that reading is hard to square with the loud refusal three lines later for the mirror case, whose stated rationale ("refuse loudly rather than drop it… only direct template input can [get here]") applies verbatim here.

## Fix sketch

Extend the existing guard: `if (preCount === 0 && cliff.kind === "fixed" && cliff.percentage.numerator !== 0) throw …` (mirroring kernel.ts:152-158), or move both geometry checks into template validation so persist/rehydrate rejects the template before compile. Not reachable via MCP DSL tools, so no MCP repro; a direct `compile()` call with the template above demonstrates it.



## Test gaps

The sharpest discrete gaps; the whole-suite judgment is in the Test-adequacy map at the end. A fourth claimed gap (the parse∘stringify fixpoint) was refuted in verification — see "How this ran."

---

**T1** · Provenance: **blind-hunt** (test-adequacy).

## Share conservation is asserted only as scattered per-case sums — no cross-arm invariant, and both as-of accounting bugs sit exactly in the untested arms

**Category:** test-gap · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/tests/resolve.classify.test.ts:~756 (events-arm-only "every share accounted for" assertion); packages/core/tests/allocate.test.ts:9-12,26 (primitive-level sums); packages/evaluator/tests/rehydrate.test.ts:120 (one template sum); no test asserts sum(vested)+sum(unvested)+sum(impossible)+unresolved === program claim across verdict arms

**Why it matters:** The engine's core promise is exact integer share conservation, but the suite pins it per-case at the primitive level and in one events-arm case only. The template-arm pending hole and the THEN-tail hole (findings 1 and 2) both pass the entire suite green — a single shared invariant helper run over the existing test programs would have caught both.

**Remedy:** Add a conservation helper (assertConserved(program, ctx): evaluateProgramAsOf buckets must sum to the program's integer claim, and for fully-fired template/events programs sum(installments) must equal exactly the allocated quantity) and run it over the existing corpus of evaluate/as-of test programs in each verdict arm: template, template+pending, events, events+pending sibling, unresolved, unresolved+THEN chain, impossible-mixed.

**Details (issue-ready):**

## Summary

Share conservation — the property the whole exact-rational allocator exists for — is only ever asserted as one-off sums: `allocateVector` sums to quantity (packages/core/tests/allocate.test.ts:9-12), the kernel oracle pins specific totals, one rehydrate case checks `sum === 4800`, and exactly one classifier test asserts "Every share of the grant is accounted for somewhere in the stream" (packages/evaluator/tests/resolve.classify.test.ts, events arm with a pending sibling).

There is no invariant of the form:

```
sum(vested) + sum(unvested) + sum(impossible) + unresolved === Σ amountToQuantify(stmt.amount)
```

run across the verdict arms. The two arms it was never asserted in are precisely the two where it currently fails (template-with-pending-EVENT-statement; unresolved-with-pending-THEN-chain — see the two bug findings). Refactors of classify.ts / assemble.ts / asof.ts can therefore redistribute or drop share claims without any test noticing, as the fix wave's restructuring demonstrates.

## Remedy

A ~20-line shared helper in evaluator's tests (and reused by pipeline's run/summary tests), applied to one representative program per arm. Where flooring legitimately under-claims pending portions (3 × floor(100/3) = 99), the invariant can assert `<= claim` with the residue bounded by the number of pending portions, keeping the deliberate floor semantics intact while still catching wholesale loss.


---

**T2** · Provenance: **blind-hunt** (test-adequacy).

## Interchange firing-invariance — the verdict's defining property — is pinned on only two handpicked schedules

**Category:** test-gap · **Confidence:** medium · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/tests/interchange.test.ts:94-113 and 168-190 are the only fired-vs-unfired equality assertions; packages/evaluator/src/resolve/interchange.ts:160-175 implements invariance solely by blanking ctx.events before resolveStatements/buildTemplate

**Why it matters:** The property is structural-by-construction today (one blanked context), but nothing stops a future change from threading a firing-dependent input through one lowering path (lowerCliff's effectiveAt, the chain cursor, absence reads) — and the suite would stay green for every shape except a bare event start and a bare event cliff. The interchange verdict is what makes the artifact safe to store; a silent invariance break is a stored-verdict that lurches when events fire.

**Remedy:** Add a corpus-level invariance check: for each program already exercised in interchange/classify tests, assert deepEqual(evaluateProgram(p, ctx).interchange, evaluateProgram(p, {...ctx, events: {}}).interchange) — and ideally with a third context where every referenced event is fired. ~15 lines over the existing fixtures; covers selectors, gates, offsets, chains, and cliffs at once.

**Details (issue-ready):**

## Summary

The interchange verdict's contract (CLAUDE.md §4: "firing-invariant, the storable floor") is enforced in code by a single trick — `resolveInterchange` re-runs the lowering against `{ ...ctx, events: {} }` (packages/evaluator/src/resolve/interchange.ts:168). The test suite asserts the fired-vs-unfired equality for exactly two schedules: a bare event-anchored start (interchange.test.ts:94-113) and a bare event cliff (interchange.test.ts:168-190).

Everything else about invariance is untested: gated starts, offset anchors, partial LATER OF combinators, THEN chains behind events, mixed programs. Because the implementation achieves invariance by construction, any future change that makes part of the lowering read a firing-adjacent input (e.g. an `asOf`-derived bound, a cached resolution, the events map reached through a helper that doesn't take ctx) would break the property silently for those shapes while both pinned cases stay green.

Additionally, no test asserts the cheap consistency property between the verdict pair (e.g. `resolution.status === "template"` implies `interchange.status ∈ {template}` for firing-free programs).

## Remedy

A corpus sweep in interchange.test.ts: collect the programs already constructed across interchange/classify/then-chain tests, and for each assert the interchange verdict is deep-equal under (a) the test's own events, (b) empty events, (c) all referenced events fired at an arbitrary date. This turns the contract from two examples into a checked property at trivial cost.


---

**T3** · Provenance: **blind-hunt** (test-adequacy).

## apps/cli is the only fully untested executable surface (445 source lines, zero tests)

**Category:** test-gap · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** apps/cli/src/{index.ts:153, evaluate.ts:113, lint.ts:82, asof.ts:55, utils.ts:26} — no test files anywhere under apps/cli; contrast apps/mcp-server (1380 test lines exercising the same pipeline through the MCP boundary)

**Why it matters:** The CLI's commands hand-render pipeline results (evaluate.ts and lint.ts carry their own presentation logic, not shared with mcp-server's), so argument parsing, the withBoundary error path, and output shaping can all regress invisibly — every other consumer of the pipeline has boundary tests.

**Remedy:** A small smoke suite mirroring mcp-server's pattern: invoke each command's action function (they're already separated from commander wiring) on one happy-path and one parse-error input, snapshotting stdout/stderr and exit behavior. ~100 lines covers all five commands.

**Details (issue-ready):**

## Summary

apps/cli has 445 source lines and zero test lines — the only executable package in the repo with no tests at all (types' zero is fine: type-only). The orientation line-count table also listed dsl/render/prettier-plugin at zero, but those were undercounts (their tests live in `tests/` dirs: dsl 640, render 496, prettier-plugin 133 test lines); cli's zero is the real one.

The risk is modest but non-zero: `evaluate.ts` (113 lines) and `lint.ts` (82 lines) contain their own result-presentation logic distinct from pipeline's view layer, `index.ts` wires commander options (--stdin, date parsing via InvalidArgumentError), and `withBoundary` (index.ts:17-24) defines the CLI's error contract (single `error:` line, exit 1, no stack leak). None of it is executed by CI.

## Remedy

The command actions are already plain functions imported into index.ts, so they can be tested without spawning a process: call each with a known DSL and assert the rendered output / thrown error; one spawn-based smoke test for the commander wiring and exit codes. mcp-server's test layout (in-memory client against createServer) is the in-repo precedent for testing an app boundary.



## Duplication

The bar this round was duplication that *survived* the #185–#193 consolidation wave or was *introduced* by it. The duplication hunter's whole-stream verdict: the wave landed cleanly — no surviving copy of any extracted pattern inside `packages/`; what accumulates now is in `apps/mcp-server`, the one consumer that grew new surface after the wave (see also A1 and B13).

---

**D1** · Provenance: **blind-hunt + architecture** (duplication, architecture) — independent discoveries; the architecture stream adds that lower.ts:701 omits the field from *stored runtimes* when it equals the local literal, making the literals load-bearing for artifact re-projection.

## The canonical day-of-month default is re-spelled as a literal at five-plus sites, including one that decides field omission in stored artifacts

**Category:** duplication · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/core/src/dates.ts:16-17 (local, unexported DEFAULT_DAY_OF_MONTH); packages/evaluator/src/utils.ts:21 (createEvaluationContext default); packages/evaluator/src/resolve/lower.ts:42,700-703 (DEFAULT_DAY_OF_MONTH used to omit vestingDayOfMonth from persisted runtime when it equals the default); apps/mcp-server/src/date-math.ts:89,139; apps/mcp-server/src/server.ts:572

**Why it matters:** These literals must agree forever: lower.ts drops the convention field from stored runtimes when it equals 'the default', and core re-applies 'the default' when the field is absent — if either side's literal ever moved alone, every previously persisted artifact would silently re-project on a different day grid.

**Remedy:** Export one DEFAULT_VESTING_DAY_OF_MONTH constant (natural home: @vestlang/types next to VESTING_DAY_OF_MONTH_VALUES, or @vestlang/core next to the stepper that applies it) and use it at all six sites. The MCP zod .describe() strings can interpolate it so the docs can't lie either.

**Details (issue-ready):**

## Sites

The value `"VESTING_START_DAY_OR_LAST_DAY_OF_MONTH"` is spelled as an independent literal at:

- packages/core/src/dates.ts:16-17 — `const DEFAULT_DAY_OF_MONTH` (module-local, not exported), the default parameter for addMonthsRule/addPeriod.
- packages/evaluator/src/utils.ts:21 — `createEvaluationContext`'s `??` default.
- packages/evaluator/src/resolve/lower.ts:42 — a second evaluator-local `DEFAULT_DAY_OF_MONTH`, used at lower.ts:700-703 to *omit* `vestingDayOfMonth` from the persisted `VestingRuntime` when the context's value equals the default.
- apps/mcp-server/src/date-math.ts:89 (dateDiff's anchor rule) and :139 (resolveOffset's context default).
- apps/mcp-server/src/server.ts:572 (add_period's tool default), plus three .describe() doc strings naming it.

## Why the lower.ts site makes this more than style

The omission at lower.ts:700-703 and the re-application in core (dates.ts:16-17, and canonical.ts:84-87's "omitted ⇒ the canonical default" contract) form a round-trip: store nothing, read back the default. That round-trip is only sound while every literal is identical. A persisted artifact (now a real consumer surface via #209's vestlang_persist/vestlang_rehydrate) would re-project on a different grid if the default were ever adjusted in one package and not another — with no type error, no test failure at the drift site, and the corruption appearing only on artifacts stored before the change.

## Fix

One exported constant — `export const DEFAULT_VESTING_DAY_OF_MONTH: VestingDayOfMonth = "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH"` — in @vestlang/types (next to VESTING_DAY_OF_MONTH_VALUES at packages/types/src/oct_types.ts:37) consumed by core, evaluator, and mcp-server. This is the same move already made for the value *list* (server.ts:100-102 consumes VESTING_DAY_OF_MONTH_VALUES "rather than re-spelling the 32 codes").


---

**D2** · Provenance: **blind-hunt × 2** (abstraction, duplication) — the duplication stream counts three days-in-month implementations and two month-arithmetic re-encodings surviving #194.

## Calendar month-diff arithmetic lives in mcp-server, not core — the #194 'all date math through core' boundary stops at the app

**Category:** abstraction · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** apps/mcp-server/src/date-math.ts:43-94 (hand-rolled daysInMonth + month-count with clamp logic); packages/core/src/dates.ts:78-117 (addMonthsRule, the clamp policy it must mirror); commit 863fc81 (#205) fixed a prior drift between the two by re-implementing the clamp in the app

**Why it matters:** date_diff(months) must agree with addPeriod on month-end clamps, and the agreement is maintained by a hand-copied Math.min(fd, daysInMonth(...)) in the app — the exact drift class #205 already paid for once. Any future change to core's clamp policy silently re-breaks the tool.

**Remedy:** Move a monthsBetween(from, to) primitive into packages/core/src/dates.ts next to addMonthsRule (its inverse), with a parity property test (monthsBetween(d, addPeriod(d, k, MONTHS, dom)) === k across month-end anchors). date-math.ts keeps only unit mapping and remainder_days shaping. The app-local daysInMonth duplicate of core's lastDay computation disappears with it.

**Details (issue-ready):**

## Problem

#194 established that all date math routes through @vestlang/core, and #205 ('make date_diff(months) agree with add_period on month-end clamps') showed what happens when it doesn't: `vestlang_date_diff`'s month arithmetic drifted from `addPeriod`'s clamp semantics. But #205 fixed the drift by re-implementing core's clamp inside the app — `apps/mcp-server/src/date-math.ts:43-47` re-derives `daysInMonth` (duplicating core's `lastDay` computation at `packages/core/src/dates.ts:94`, down to the same setUTCFullYear year-0–99 caveat), and `date-math.ts:75-81` re-encodes the month-end clamp (`Math.min(fd, daysInMonth(ty, tm))`) that `addMonthsRule` owns. The inverse of core's month stepper now lives outside core, tied to it only by a comment ('matching how core constructs its dates').

## Why it matters

The whole point of the tool pair is that `date_diff(from, add_period(from, k months)) === k`. That invariant is currently maintained by parallel hand-written arithmetic in two packages. A change to core's clamp policy (or a new VestingDayOfMonth behavior) re-breaks the agreement silently — there is no parity test, and the app is outside core's test suite.

## Remedy

Add `monthsBetween(from: OCTDate, to: OCTDate): { diff: number; remainderDays: number }` to `packages/core/src/dates.ts`, implemented against `addMonthsRule` itself (probe k until `addMonthsRule(from, k)` passes `to`, like `measureDuration` in evaluator/resolve/cliff.ts already does), or keep the closed-form but house it next to the stepper with a property test: for every month-end anchor and k, `monthsBetween(d, addPeriod(d, k, "MONTHS", dom)).diff === k`. `date-math.ts` then shrinks to unit mapping (weeks→days) and response shaping. Verified the current pair agrees today (add_period(2025-01-31, 1 month) = 2025-02-28; date_diff(2025-01-31, 2025-02-28, months) = {diff: 1, remainder_days: 0}) — this is a drift-prevention consolidation, not a live bug.


---

**D3** · Provenance: **blind-hunt** (duplication).

## Peggy's thrown-SyntaxError shape is sniffed independently in pipeline and linter — the parser's error contract has no owner

**Category:** duplication · **Confidence:** medium · **Verifier:** confirmed (novel)

**Evidence:** packages/pipeline/src/parse.ts:31-56 (ThrownParseError type + toPipelineError: `e?.name === "SyntaxError" && e.location`, start/end line/column copy); packages/linter/src/index.ts:69-103 (lintText's catch: identical name/location sniff and line/column copy, different fallback ruleId 'unexpected-error' vs pipeline's loc-less 'syntax-error')

**Why it matters:** Two packages each hard-code knowledge of what @vestlang/dsl's parser throws (an untyped peggy error duck-typed via `name === "SyntaxError"` and a `.location` field). If the grammar/peggy version changes that shape, both decoders rot independently — and they already disagree on the fallback classification for a non-positional throw.

**Remedy:** Have @vestlang/dsl own its thrown-error contract: export a typed guard/decoder (e.g. `asParseError(err): { message, loc? } | undefined`) next to `parse`, and have both toPipelineError and lintText build their own output shapes (PipelineError vs Diagnostic) from that one decode. Neither package needs to depend on the other; both already depend on dsl.

**Details (issue-ready):**

## The two copies

1. packages/pipeline/src/parse.ts:31-56 — declares a local `ThrownParseError` shape and `toPipelineError`, which checks `e?.name === "SyntaxError" && e.location` and copies `location.start/end.{line,column}` into the pipeline's `Loc`. Falls back to `{ruleId: "syntax-error", message}` with no loc.
2. packages/linter/src/index.ts:69-103 — `lintText`'s catch declares the same shape inline, performs the same `e.name === "SyntaxError" && e.location` check, copies the same four coordinates into a `Diagnostic`, and additionally builds a code frame. Falls back to `{ruleId: "unexpected-error", ...}`.

Both blocks exist because @vestlang/dsl exports `parse` but not the shape of what `parse` throws — so each consumer duck-types peggy's error independently. This survived #208 (3604523), which moved the linter onto a direct `parse` import (making @vestlang/dsl "an honest runtime dependency of the linter alone") without giving dsl ownership of the error contract.

## Drift already visible

The two decoders classify the loc-less fallback differently: pipeline calls any non-positional parse throw a `syntax-error` (no loc), the linter calls it `unexpected-error`. Harmless today, but it's the kind of divergence that compounds.

## Fix sketch

@vestlang/dsl exports something like:

```ts
export interface ParseFailure { message: string; loc?: { start: {line, column}, end: {line, column} } }
export function asParseFailure(err: unknown): ParseFailure | undefined
```

`toPipelineError` and `lintText` then map one decoded value into their own vocabularies. The peggy-shape knowledge (including the `name === "SyntaxError"` duck test and the guarantee, noted in parse.ts:31-33, that every reachable grammar guard now carries a location) lives once, next to the grammar that creates it.


---

**D4** · Provenance: **blind-hunt** (duplication) — low confidence.

## probeLaterOf re-evaluates a partial LATER OF to recompute the pivot date the selector fold already computed and stamped

**Category:** duplication · **Confidence:** low · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/src/evaluate/utils.ts:31-52 (probeLaterOf: second evaluation of every arm, manual latest-resolved-date scan); packages/evaluator/src/evaluate/selectors.ts:166-194 (handleSelector's partialEmit branch: reduceBest over resolved arms produces best.meta.date and stamps it into the blockers via withBoundary); packages/evaluator/src/resolve/cliff.ts:189-198 (lowerCliff calls probeLaterOf on the same cliffExpr/overlayCtx that evaluateVestingNodeExpr at cliff.ts:138 just folded)

**Why it matters:** Two implementations of 'the latest settled arm of a partially-resolved LATER OF' must agree: the fold's copy feeds the absence-assumption boundary (the `through` date disclosed to users), the probe's copy feeds the cliff's probeDate that positions pre-cliff tranches. Today they evaluate the same expression twice and happen to match; a policy change in handleSelector (e.g. how nested selectors settle) would move one and not the other.

**Remedy:** Have the partial-emit branch carry the pivot on its return value (e.g. the UNRESOLved meta gains an optional `settledThrough: OCTDate`, the same value it already passes to withBoundary), and have lowerCliff read it off the single resolution at cliff.ts:189-198 instead of re-running probeLaterOf. Delete probeLaterOf.

**Details (issue-ready):**

## The two computations

When a `LATER OF (...)` has some arms resolved and some pending, two places independently determine "the latest date settled so far":

1. **The selector fold** — packages/evaluator/src/evaluate/selectors.ts:166-194. The `partialEmit` branch runs `reduceBest(resolved, policy.selector)` and uses `best.meta.date` as the boundary stamped onto the pending arms' blockers (`withBoundary(collectBlockers(live), best.meta.date)`). That date ends up in the published absenceAssumptions (`through`).
2. **The probe** — packages/evaluator/src/evaluate/utils.ts:31-52 `probeLaterOf` re-evaluates every arm of the same expression with `evaluateVestingNodeExpr` and scans for the latest RESOLVED date. packages/evaluator/src/resolve/cliff.ts:189-198 calls it on the *same* `cliffExpr` and `overlayCtx` that line 138 already folded, to obtain `probeDate` — the pivot that resolve/unresolved.ts:128-137 folds pre-cliff tranches onto.

So each partial-LATER-OF cliff is evaluated twice end-to-end, purely because the fold computes the pivot and then drops it (it survives only inside blocker `through` stamps, in a lossy merged form).

## Risk and caveat

This survived #192 (which unified the two selector folds but didn't surface the partial pivot on the return type). It is currently consistent — both copies reduce over the same resolved set — so this is a drift hazard plus a redundant evaluation pass, not a live bug; flagging at low confidence accordingly. The clean fix is for the fold's partial pick to carry its pivot (the DU for `Picked.meta` already distinguishes the partial case at evaluate/utils.ts:12-19), making cliff.ts a pure reader and deleting the second implementation.



## Type-model

The #195–#198 DU wave genuinely landed; what it missed clusters in one place — the evaluator-internal `LoweredCliff`/`StmtResolution` records in `resolve/lower.ts` + `cliff.ts`, which still encode state in optionals. Notably, bugs B2 and B3 both live in exactly the branch those weak types couldn't constrain (the pending-head THEN tail, where the resolver fabricates a record by hand and nothing in the type objected). That coupling is the strongest argument for M1 and AR2.

---

**M1** · Provenance: **blind-hunt** (type-model) — the remodel that would have prevented B2/B3; both bugs live exactly in the branch these weak types couldn't constrain.

## LoweredCliff hides sub-states in optional fields: EVENT fired-ness as `effectiveAt?`, UNRESOLVED render shape as `dated` + `probeDate?`

**Category:** type-model · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/src/resolve/cliff.ts:38-60 (the type); consumers branching on presence: lower.ts:566-571 (`state === "EVENT" && effectiveAt === undefined`), classify.ts:67-82 (`effectiveAt === undefined` → withheld), unresolved.ts:110-137 (three-way `!dated` / `probeDate === undefined` / fold), resolve/index.ts:99 (returns effectiveAt as the cliff date)

**Why it matters:** These are exactly the disguised discriminants the #195-#198 wave removed elsewhere: an EVENT cliff is semantically two states (fired with a date / unfired) and an UNRESOLVED cliff three render shapes ({dated:false}, {dated:true}, {dated:true,probeDate}), but the compiler can't enforce either invariant — `{dated:false, probeDate}` is constructible and every consumer re-derives the state by undefined-checks.

**Remedy:** Split the arms: `{ state: "EVENT_FIRED"; eventId; effectiveAt: OCTDate } | { state: "EVENT_PENDING"; eventId }` and `{ state: "UNRESOLVED"; shape: { kind: "symbolic" } | { kind: "dated" } | { kind: "dated-floor"; probeDate: OCTDate }; blockers }` (or three sibling states). Consumers in lower.ts/classify.ts/unresolved.ts/index.ts then narrow on the tag instead of on undefined.

**Details (issue-ready):**

## Summary

`LoweredCliff` (packages/evaluator/src/resolve/cliff.ts:38-60) is the per-statement cliff record the resolver, classifier, projection, and interchange all route on. Two of its arms encode further states in optional/boolean fields rather than in the discriminant:

1. **EVENT arm** — `{ state: "EVENT"; eventId: string; effectiveAt?: OCTDate }`. `effectiveAt` present ⇔ the event fired. Every consumer branches on presence:
   - lower.ts:566-571: unfired → `unresolved` verdict; fired → `events` verdict.
   - classify.ts:67-82: `effectiveAt === undefined` → return [] (withheld), else proportional cliff.
   - unresolved.ts:110-119: `effectiveAt !== undefined ? EMPTY : makeUnresolvedCliffSchedule(...)`.
   - resolve/index.ts:99: `return r.cliff.effectiveAt` as the statement's cliff date.
   This is the same shape #196 fixed for the start ("model RESOLVED start base as a DU with required eventId"): fired vs unfired is a state, not a field.

2. **UNRESOLVED arm** — `{ state: "UNRESOLVED"; blockers; dated: boolean; probeDate?: OCTDate }`. Construction sites produce exactly three shapes ({dated:false} at cliff.ts:198/305/318, {dated:true} at cliff.ts:200, {dated:true, probeDate} at cliff.ts:197) and the single consumer (unresolved.ts:121-137) decodes them as three distinct render paths (fully symbolic / dated grid / dated grid folded onto a LATER-OF floor). `probeDate` is meaningful only when `dated` is true — a co-varying optional. The illegal `{dated:false, probeDate: ...}` typechecks today.

Also worth fixing while there: the arm's doc comment (cliff.ts:50-51) still says `dated`/`probeDate` are "populated in a later phase (placeholders until then)" — they are populated now (cliff.ts:189-200).

## Why now

Findings about the pending-tail branch in this review require touching exactly these records; remodeling first makes those fixes compiler-checked.

## Sketch

```ts
type LoweredCliff =
  | { state: "NONE" }
  | { state: "RESOLVED"; cliff: Cliff }
  | { state: "EVENT_FIRED"; eventId: string; effectiveAt: OCTDate }
  | { state: "EVENT_PENDING"; eventId: string }
  | { state: "UNRESOLVED"; blockers: Blocker[];
      shape: { kind: "symbolic" } | { kind: "dated" } | { kind: "dated-floor"; floor: OCTDate } }
  | { state: "IMPOSSIBLE"; blockers: ImpossibleBlocker[] };
```


---

**M2** · Provenance: **blind-hunt** (type-model).

## Every symbolic installment bakes rendered prose (`unresolved: string`) into the engine, duplicating its structured blockers and violating the prose-at-the-view-boundary rule

**Category:** type-model · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/types/src/evaluation.ts:104-115 (UnresolvedInstallment/ImpossibleInstallment both carry `unresolved: string`); packages/evaluator/src/evaluate/makeTranches.ts:14-17 (renderBlockers comma-joins blockerToString) and 73, 91, 107, 126 (every symbolic builder stores it); contrast the rule stated at packages/types/src/evaluation.ts:179-181 and packages/pipeline/src/view.ts:34-36 ("prose is rendered only at this boundary")

**Why it matters:** The #181/#185 wave moved reasons and blocker rendering to structured data with prose only at the view boundary, but each installment still carries a pre-rendered, comma-joined copy of the same blockers that ride beside it in the InstallmentSet — redundant data that can drift from the structured truth, and the field is misnamed on the IMPOSSIBLE arm (a contradiction isn't "unresolved").

**Remedy:** Drop `unresolved` from both installment arms (consumers that want prose render it from the sibling blockers via pipeline, the same way `reason` and findings are rendered), or if per-installment attribution is the point, carry structured `blockers: Blocker[]` on the installment and render at view time.

**Repro:**
```
mcp__vestlang__vestlang_evaluate {"dsl": "VEST FROM EVENT ipo OVER 12 MONTHS EVERY 1 MONTH", "grant_date": "2025-01-01", "grant_quantity": 1200} → each installment carries "unresolved": "EVENT ipo" alongside the structured blockers array carrying the same fact
```

**Details (issue-ready):**

## Summary

`UnresolvedInstallment` and `ImpossibleInstallment` (packages/types/src/evaluation.ts:104-115) each carry `unresolved: string`. The value is always `renderBlockers(blockers)` — a comma-joined `blockerToString` dump of the very blockers array that travels next to the installments in the same `InstallmentSet` (makeTranches.ts:14-17, with all four symbolic builders storing it at lines 73, 91, 107, 126).

This is the pattern the recent fix wave explicitly retired elsewhere: #181 made the non-template reason structured ("Rendered to prose only at the view boundary, so a consumer can still gate on the kind" — evaluation.ts:179-181), #185 delegated blocker rendering to render's printer, and pipeline/view.ts:34-36 declares itself the one place prose is derived. The installment stream is the one published surface still shipping engine-rendered English (`"unresolved": "EVENT ipo"` in MCP output), and:

- it duplicates the structured blockers (two sources of truth; a stamped `through` boundary appears in the blocker but not in the prose, so they already diverge in detail),
- consumers can't gate on it structurally,
- the name is wrong on the IMPOSSIBLE arm — an `ImpossibleInstallment`'s `unresolved` field describes a contradiction, not pending-ness.

## Suggested fix

Remove the field from both arms and have the view layer render per-installment text on demand from the sibling blockers (or, if per-installment blocker attribution matters — the schedule-level list loses which installment waits on what — replace the string with `blockers: Blocker[]` and render in pipeline). No external consumers pin the field (no-compat-shims rule applies).


---

**M3** · Provenance: **blind-hunt** (type-model).

## classify() declares the full ResolveVerdict union it can never produce, forcing a dead defensive throw in the interchange mapper

**Category:** type-model · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/src/resolve/classify.ts:233-239 (returns ResolveVerdict; eventsArm/unresolvedArm only ever construct events/unresolved/impossible); packages/evaluator/src/resolve/interchange.ts:116-123 (switch must name `case "template"` and throws "a non-template build classified as a template")

**Why it matters:** The declared return type is wider than the function's actual range, so the impossible arm is handled at runtime with a throw instead of being unrepresentable — exactly the drift-prone pattern #197 removed by deriving ResolutionStatus from the verdict arms.

**Remedy:** Type classify (and eventsArm/unresolvedArm) as `Exclude<ResolveVerdict, { kind: "template" }>` (or a named `ClassifiedVerdict`). The interchange switch then narrows exhaustively over the three real arms and the throw is deleted; resolveToCore's `verdict` assignment is unaffected since the narrower type assigns into ResolveVerdict.

**Details (issue-ready):**

## Summary

`classify` (packages/evaluator/src/resolve/classify.ts:233-239) takes `Extract<TemplateBuild, { ok: false }>` — by construction a non-template build — and dispatches to `unresolvedArm`/`eventsArm`, which return only the `events`, `unresolved`, and `impossible` verdict kinds. Yet all three functions are typed `ResolveVerdict`, the full four-arm union including `template`.

The cost shows up in `mapTemplateBuild` (interchange.ts:116-123): the switch over `classify(...)`'s result must name `case "template"` and handles it with a runtime throw, annotated with a comment explaining that the case is unreachable but "its return type spans the whole verdict union, so we name the case rather than leave the switch open."

That is the type doing the wrong job: the function's range should be its declared type. #197 applied the same principle to ResolutionStatus (derive, don't restate). With

```ts
export type ClassifiedVerdict = Exclude<ResolveVerdict, { kind: "template" }>;
export const classify = (...): ClassifiedVerdict => ...
```

the dead `case "template"` + throw is deleted, the exhaustiveness tripwire still fires on any new verdict kind, and `resolveToCore` (resolve/index.ts:58-72) compiles unchanged because the narrower union assigns into `ResolveVerdict`.


---

**M4** · Provenance: **blind-hunt** (type-model).

## Blocker types re-spell the SelectorTag union by hand instead of using the exported alias two files away

**Category:** type-model · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/types/src/evaluation.ts:48 and 59 (`selector: "EARLIER_OF" | "LATER_OF"` on UNRESOLVED_SELECTOR and IMPOSSIBLE_SELECTOR) vs packages/types/src/helpers.ts:8 (`export type SelectorTag = "EARLIER_OF" | "LATER_OF"` — documented as the vocabulary that "flows into evaluator output and blocker messages"); producers already type against SelectorTag (packages/evaluator/src/evaluate/selectors.ts:58-67, 100-119)

**Why it matters:** A hand-maintained copy of a discriminant inside the same package: helpers.ts explicitly names SelectorTag as the computed-result vocabulary the blockers speak, yet the two blocker arms restate the literals, so adding a selector kind updates one site and silently misses the other.

**Remedy:** Replace both inline unions with `selector: SelectorTag` (evaluation.ts already imports from sibling modules; add SelectorTag to the helpers import).

**Details (issue-ready):**

## Summary

`packages/types/src/helpers.ts:8` defines `SelectorTag = "EARLIER_OF" | "LATER_OF"` with a doc comment stating this exact purpose: "this value flows into evaluator output and blocker messages." The evaluator's selector machinery types against it (`SelectorPolicy.selector: SelectorTag`, packages/evaluator/src/evaluate/selectors.ts:100-119; `chooseBest`, 58-67).

But the two blocker arms that carry the value — `UNRESOLVED_SELECTOR` (evaluation.ts:46-50) and `IMPOSSIBLE_SELECTOR` (evaluation.ts:56-61) — re-spell the literal union by hand instead of referencing the alias. The values flow directly from `policy.selector: SelectorTag` into these fields (selectors.ts:126-136, 181-203), so the two spellings are structurally coupled today and stay equal only by hand.

This is the smallest instance of the "string union here, kept in sync by hand" pattern, but it sits in the published types package where the cost of drift is highest. One-line fix per site: `selector: SelectorTag` with the import from `./helpers.js`.


---

**M5** · Provenance: **blind-hunt × 2** (type-model, abstraction) — independent discoveries.

## MCP persist/rehydrate publish blockers as `unknown[]`, and the artifact zod schemas hand-mirror canonical.ts with no type-level binding

**Category:** type-model · **Confidence:** medium · **Verifier:** confirmed (novel)

**Evidence:** apps/mcp-server/src/persist.ts:143 (`PersistResult ... blockers: unknown[]`) and 216-220 (`RehydrateOutput ... pending: unknown[]`) — the runtime values are `Blocker[]` (resolution.blockers at persist.ts:191; RehydrateResult.blockers, packages/evaluator/src/resolve/rehydrate.ts:33-41); persist.ts:39-128 (ISO_DATE/FRACTION/CLIFF/VESTING_STATEMENT/TEMPLATE/RUNTIME/SOURCE_MAP_ENTRY/SIDECAR re-spell the canonical.ts interfaces field by field with `.strict()`, no `satisfies z.ZodType<...>` tie)

**Why it matters:** `unknown[]` erases the structured Blocker contract from the persistence tools' published output (a consumer must reverse-engineer the shape the evaluate tool documents), and the hand-copied zod mirror of canonical.ts can drift silently — a field added to the canonical types would make the `.strict()` schemas reject previously-valid stored artifacts with no compile-time signal.

**Remedy:** Type the two fields as `Blocker[]` (the type is exported from @vestlang/types). Bind each zod schema to its source-of-truth interface with `satisfies z.ZodType<VestingScheduleTemplate>` / `z.ZodType<PersistedArtifact>` (or build them from a shared schema module) so canonical.ts changes surface as typecheck failures in persist.ts.

**Details (issue-ready):**

## Summary

Two related softness points in the freshly-added persistence tool pair (#209), both in apps/mcp-server/src/persist.ts:

1. **`unknown[]` blockers.** `PersistResult` (persist.ts:142-144) declares `blockers: unknown[]` and `RehydrateOutput` (persist.ts:216-220) declares `pending: unknown[]`. The values actually flowing through are `Blocker[]`: persist returns `resolution.blockers` off the template verdict (persist.ts:191), and rehydrate returns `RehydrateResult.blockers`, declared `Blocker[]` (packages/evaluator/src/resolve/rehydrate.ts:33-41). The tool descriptions tell the caller these are "advisory pending witnesses," but the type tells TypeScript nothing — any future logic over them needs casts, and JSON consumers get an undocumented shape that the evaluate tool's blockers already define precisely. Since `Blocker` is exported from @vestlang/types (already a dependency), `unknown[]` buys nothing.

2. **Hand-mirrored zod schemas.** persist.ts:39-128 restates the entire canonical family (Fraction, Cliff, TemplateVestingBase, VestingStatement, VestingScheduleTemplate, VestingRuntime, SourceMapEntry, Sidecar, PersistedArtifact) as zod objects, all `.strict()`. Nothing binds them to the interfaces in packages/types/src/canonical.ts. The only implicit check is that `z.infer<typeof PERSISTED_ARTIFACT>` happens to be assignable to `runRehydrate`'s `PersistedArtifact` parameter — which does not catch a zod schema that *omits* a newly added optional canonical field. Because the schemas are `.strict()`, that drift is not benign: an optional field added to `VestingRuntime` tomorrow would make every artifact persisted by the new evaluator **fail validation on rehydrate**, with no compile-time warning anywhere.

Both are one-file fixes: import `Blocker`, and annotate each schema with `satisfies z.ZodType<CorrespondingType>`.


---

**M6** · Provenance: **blind-hunt** (abstraction).

## core's day-of-month picker disables the exhaustiveness tripwire and parseInts whatever lands in default — a future named VestingDayOfMonth member would NaN into a mislabeled RangeError

**Category:** type-model · **Confidence:** medium · **Verifier:** confirmed (novel)

**Evidence:** packages/core/src/dates.ts:96-113 (pickDay switch; eslint-disable at :100; default does parseInt(dayOfMonth, 10)); eslint.config.mjs:80-86 (the tripwire this is the only production opt-out of)

**Why it matters:** This is the one discriminant switch in the repo where the AST-drift tripwire is explicitly switched off; the union mixes 28 numeric-string members with 4 named policies, forcing the disable, so a 5th named member added later (OCF enum growth) routes to parseInt → NaN → an invalid Date → a RangeError blaming 'arithmetic overflowed' instead of the unhandled policy.

**Remedy:** Split the union at the type level — VestingDayOfMonth = NamedDayPolicy | NumericDayOfMonth — and switch exhaustively over NamedDayPolicy with the numeric branch typed as the parseInt path (a /^\d{2}$/ template-literal type or a guard). The eslint-disable disappears and a new named policy becomes a compile error here, the same guarantee every other node switch has.

**Details (issue-ready):**

## Problem

The repo's switch-exhaustiveness lint is configured as a deliberate drift tripwire — `considerDefaultExhaustiveForUnions: false`, so a `default` arm never substitutes for a missing case (eslint.config.mjs:80-86). I audited all 18 production `default:` arms; 17 are either `assertNever` or untrusted-input boundary rejections. The single opt-out is `pickDay` in `packages/core/src/dates.ts:96-113`: because `VestingDayOfMonth` is a flat union of the numeric literals "01"–"28" plus four named policies, enumerating it would mean 28 explicit cases, so the rule is disabled (:100) and the default does `Math.min(parseInt(dayOfMonth, 10), lastDay)`.

Today every runtime entry point constrains the value (zod `z.enum(VESTING_DAY_OF_MONTH_VALUES)` in both MCP apps), so nothing unhandled can arrive at runtime. The exposure is type evolution: VestingDayOfMonth tracks an OCT/OCF enum, and if a fifth *named* member is ever added (e.g. a LAST_DAY_OF_MONTH variant), nothing breaks at compile time — the new member silently routes to `parseInt("LAST_DAY_OF_MONTH")` → NaN → `Math.min(NaN, lastDay)` → NaN day → invalid Date → `toISO` throws `RangeError: date out of representable range 0001–9999 (arithmetic overflowed)`. Loud, but blaming arithmetic overflow for an unclassified policy, in the single function every month step in the engine funnels through.

## Remedy

Model the union as it is actually used: `type VestingDayOfMonth = NamedDayPolicy | NumericDayOfMonth` (the numeric side as the 28 literals it already is, just named as a sub-union). `pickDay` then switches exhaustively over `NamedDayPolicy` — restoring the tripwire with zero disable — and handles `NumericDayOfMonth` on a typed branch where `parseInt` is correct by construction. Alternatively (cheaper, runtime-only): keep the switch but make the default guard `if (!/^\d{2}$/.test(dayOfMonth)) throw new Error(\`unhandled VestingDayOfMonth policy: ${dayOfMonth}\`)` before the parseInt.

Low urgency (no path produces the failure today), but it is the only place in the codebase where the AST-drift guarantee the lint config promises is structurally absent.



## Abstraction

The abstraction hunter's whole-stream verdict: clean inside the packages the fix wave touched. The walk-vs-consumers split (commit b2f219c's rationale) still holds and has strengthened; all 10 selector-tag switches are distinct concerns behind the exhaustiveness lint; of 18 production `default:` arms, 17 are sound (12 assertNever, 5 boundary rejections) — the one genuine tripwire bypass is M6. What remains sits at the app seam (D2, B13) and in two semantic mirrors (AR3, D3).

---

**A1** · Provenance: **blind-hunt** (duplication) — the duplication stream's whole-stream judgment generalizes this: the pipeline boundary needs to grow at the same rate as the MCP tool surface, or each new tool re-implements the seam.

## The MCP persistence tools rebuilt consumer orchestration the pipeline exists to own: three hand-built EvaluationContextInputs in apps/mcp-server

**Category:** architecture · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** apps/mcp-server/src/persist.ts:158-167 (runPersist builds EvaluationContextInput inline), apps/mcp-server/src/persist.ts:247-256 (runRehydrate, second copy); apps/mcp-server/src/date-math.ts:133-141 (resolveOffset, third copy); packages/pipeline/src/context.ts:1-9 ('Kept internal to the pipeline ... so an app can't construct a context by hand and forget a piece (the named-events drop that bit the CLI's as-of command came from exactly that)'); packages/pipeline/src/index.ts:1-3 ('everything between user input and the engine lives here, once'); also apps/mcp-server/src/persist.ts:39-41 vs apps/mcp-server/src/server.ts:84-87 (two ISO_DATE zod consts in one app, the persist.ts one missing the isValidCalendarDate refine)

**Why it matters:** The pipeline was created (#20aa6e8/#30d1e31/#679e81c, reaffirmed by #201) precisely so apps never hand-assemble parse→context→evaluate; #209 then put a whole new orchestration (runPersist/runRehydrate) in the app, with two by-hand context literals plus a third in resolveOffset — the exact bug class the context builder's own comment warns about.

**Remedy:** Move runPersist/runRehydrate into @vestlang/pipeline as run* entry points (they already follow the same Result-shaped pattern as runEvaluate), routing context construction through buildContext (which accepts as_of, so the asOf=grant_date defaults survive). resolveOffset should call buildContext too (export it or add a pipeline entry). Reuse one ISO_DATE schema with the calendar-date refine. Optionally pin the artifact zod mirror with `satisfies z.ZodType<PersistedArtifact>` so drift against packages/types/src/canonical.ts fails typecheck.

**Details (issue-ready):**

## The pattern

packages/pipeline/src/context.ts says, in its header comment: the context builder is "Kept internal to the pipeline: the run* entry points call it with their own inputs, so an app can't construct a context by hand and forget a piece (the named-events drop that bit the CLI's as-of command came from exactly that)." Every pre-#209 consumer honors this: the CLI and the six older MCP tools all route through pipeline run* functions.

#209 (vestlang_persist / vestlang_rehydrate) added persistence orchestration directly in the app instead:

- apps/mcp-server/src/persist.ts:158-167 — `runPersist` hand-builds an `EvaluationContextInput` (grantDate / events spread / grantQuantity / asOf / conditional vesting_day_of_month) and calls `evaluateProgram` from @vestlang/evaluator directly.
- apps/mcp-server/src/persist.ts:247-256 — `runRehydrate` builds a second, near-identical literal.
- apps/mcp-server/src/date-math.ts:133-141 — `resolveOffset` builds a third (predates #209 but is the same drift).

All three are currently *correct* (grantDate is its own field, events spread untouched), but they are exactly the copies the builder exists to prevent — e.g. a future context field added in `buildContext` will silently not reach persist/rehydrate/resolveOffset.

## Secondary duplications inside the same boundary

1. Two zod `ISO_DATE` constants in one app: server.ts:84-87 refines with `isValidCalendarDate`; persist.ts:39-41 is regex-only, so a rehydrate artifact carrying `2025-02-31` passes the tool schema and only fails deeper (core's runtime validator) with a less actionable error.
2. persist.ts:43-126 hand-mirrors the whole canonical artifact shape (Fraction, Cliff, VestingStatement, VestingRuntime...) from packages/types/src/canonical.ts as zod objects with no compile-time tie. It is in sync today; nothing breaks the build when canonical.ts changes. `const PERSISTED_ARTIFACT = z.object({...}) satisfies z.ZodType<PersistedArtifact>` (or zod schemas co-located near the types) would make drift a typecheck failure.

## Why pipeline, not the app

Moving runPersist/runRehydrate to @vestlang/pipeline (a) deletes two of the three context literals, (b) gives the CLI persist/rehydrate for free, consistent with "the shared consumer front door", and (c) keeps the zod tool-input schemas in the app where they belong while the orchestration lives once. Note pipeline already depends on evaluator, so no new edges are needed.



## Vestigial

The relocation residue the brief predicted is real but smaller than expected — what survives is mostly *signature-level* fossils rather than wrapper modules, concentrated at the evaluator's public boundary (its `index.ts` is the only file where the export list, the comments, and the consumers disagree with each other). V1 is the highest-leverage; V2–V8 could ship as a single chore PR; V9–V11 are a comment/docs sweep. Deliberately *not* flagged: core's validators and string-amount `compile()` (intended OCF-Tools surface), test-deep-import exports (the #200 convention), and `InferInput.policy` (documented API — though the MCP `vestlang_infer_schedule` tool doesn't expose it, a small tool-surface gap worth a thought). Also: `packages/ast/` is an empty untracked husk (only `.turbo` logs and a stale `node_modules`; `git ls-files packages/ast` is empty) — local machine debris, an `rm -rf` candidate, not a repo issue.

---

**V1** · Provenance: **blind-hunt** (vestigial) — the highest-leverage cleanup: touches four packages' dummy values and a five-deep threading in the inferrer. Note the #102 interaction flagged inside: if #102 adopts through=asOf, asOf becomes a genuine compiler input and the remedy inverts.

## EvaluationContext requires an `asOf` the compiler never reads — every compiler-path caller fabricates a dummy date

**Category:** vestigial · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** Required field: packages/types/src/evaluation.ts:15 (and EvaluationContextInput, lines 20–24, does not exempt it). Only genuine reads in the entire evaluator: packages/evaluator/src/asof.ts:72 and :102 (the as-of partition). Nothing under packages/evaluator/src/resolve/ or packages/evaluator/src/evaluate/ reads ctx.asOf (verified by grep — the only hits are comments, e.g. evaluate/vestingNode/vestingBase.ts:46-47 explicitly saying resolution never gates on asOf). Dummy values fabricated to satisfy the type: apps/mcp-server/src/date-math.ts:137 (asOf: "9999-12-31"), apps/mcp-server/src/persist.ts:162 (asOf: input.grant_date) and :251, packages/inferrer/src/coincidentCliff.ts:30 (asOf: "2999-12-31"), packages/inferrer/src/infer.ts:338 (passes lastDate). The inferrer threads this dead value through five signatures: infer.ts:105/159/228/286, preGrantFold.ts:21/78, verify.ts:15/23/26/54.

**Why it matters:** The compiler's context type forces a parameter the compiler is invariant to, so four packages invent sentinel dates and the inferrer plumbs one through its whole call stack — classic signature-widened-for-a-caller-that-isn't-there, and a reader can't tell the resolution is asOf-invariant without auditing it.

**Remedy:** Drop `asOf` from EvaluationContext/EvaluationContextInput and make it an explicit parameter of the two entry points that actually use it, evaluateStatementAsOf/evaluateProgramAsOf (pipeline's runAsOf already carries asOf separately and run.ts:7-8 even documents that an as-of date should only appear where it means something). Delete the sentinel dates in mcp-server/persist.ts, mcp-server/date-math.ts, and the inferrer's threading. One interaction to settle first: open issue #102 proposes stamping bare pending events with through = asOf, which would make asOf a real compiler input — decide that before or together with this change.

**Details (issue-ready):**

EvaluationContext (packages/types/src/evaluation.ts:8-17) requires `asOf: OCTDate`, and EvaluationContextInput (lines 20-24) only exempts `vesting_day_of_month`. But the compiler proper — evaluateStatement / evaluateProgram / resolveToCore / resolveInterchange / rehydrate — never reads it. The only reads of `ctx.asOf` in @vestlang/evaluator are in src/asof.ts:72 and :102, inside the vested/unvested partition. evaluate/vestingNode/vestingBase.ts:46-47 even documents the invariant: "never gate it on asOf: whether the schedule has actually reached this date yet is decided later, by comparing installment dates against asOf."

Consequences today:
- apps/mcp-server/src/date-math.ts:137 fabricates `asOf: "9999-12-31"` to call evaluateStatement.
- apps/mcp-server/src/persist.ts:162 fabricates `asOf: input.grant_date` for the persist compile; :251 defaults it for rehydrate (rehydrate also never reads it — its only `asOf` occurrence is a doc comment at resolve/rehydrate.ts:87).
- packages/inferrer/src/coincidentCliff.ts:30 fabricates `asOf: "2999-12-31"`.
- packages/inferrer/src/infer.ts threads an `asOf` parameter through runOne (line 105), the attempt loop (:338, passing `lastDate`), and on through preGrantFold.ts:21/:78 and verify.ts makeVerifyContext (:23-26) — five signatures carrying a value whose only purpose is to satisfy the context type of evaluateStatement calls whose output is asOf-invariant.

Proposed fix: remove `asOf` from EvaluationContext/EvaluationContextInput; give evaluateStatementAsOf/evaluateProgramAsOf an explicit `asOf: OCTDate` parameter. pipeline/run.ts already treats asOf as a separate concern (runAsOf takes it as its own argument and run.ts:7-8 says "an 'as of' date only appears where it means something. Don't fold them back into one ctx argument") — the type should match that design. Then delete the sentinel dates and the inferrer threading.

Caveat / sequencing: issue #102 (absence-assumptions: optionally over-record bare pending events with through = asOf) would, if adopted, make asOf a genuine input to the resolution. That decision should be taken first; if #102 lands as proposed, this finding inverts into "document that asOf is a real compiler input." As the code stands today, it is dead weight.


---

**V2** · Provenance: **blind-hunt × 2** (vestigial, abstraction) — independent discoveries.

## evaluateProgram returns a one-element array; every caller immediately destructures index 0

**Category:** vestigial · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/src/evaluate/index.ts:80-90 — the function's own doc comment says "returned as a one-element array" and the body is `return [assemble(...)]`. Production callers, all destructuring element 0: packages/evaluator/src/asof.ts:92, packages/recover/src/recover.ts:32 and :65, packages/inferrer/src/verify.ts:95 and :135, apps/mcp-server/src/persist.ts:170. Every test caller does the same (e.g. packages/evaluator/tests/absence-assumptions.test.ts:85, packages/pipeline/tests/present.test.ts:198).

**Why it matters:** The array shape is a fossil of the dropped per-statement verdict model (commit 8d68357 "one program-scoped evaluate; drop the per-statement verdict"); it forces a `[schedule] =` ritual at six production call sites and falsely suggests the program can yield multiple schedules.

**Remedy:** Change evaluateProgram's return type to a single EvaluatedSchedule and update the six production callers (plus tests) to drop the destructuring. evaluateClauseGroups keeps its array — there the plurality (one schedule per THEN chain) is real.

**Details (issue-ready):**

`evaluateProgram` (packages/evaluator/src/evaluate/index.ts:80-90) is documented as collapsing the program to ONE canonical schedule and literally returns `[assemble(resolveToCore(stmts, ctx_input), resolveInterchange(stmts, ctx_input))]`. The plural return type predates commit 8d68357, which dropped the per-statement verdict in favor of the single program-scoped evaluate; nothing has needed the array since.

Every caller in the repo unwraps element 0:
- packages/evaluator/src/asof.ts:92 — `const [schedule] = evaluateProgram(program, ctx_input);`
- packages/recover/src/recover.ts:32 — `const [schedule] = evaluateProgram(stmts, ctx);` and :65 — `const [published] = evaluateProgram(inferred.program, reclassifiedCtx);`
- packages/inferrer/src/verify.ts:95 and :135 — `const [schedule] = evaluateProgram(program, {...});`
- apps/mcp-server/src/persist.ts:170 — `[schedule] = evaluateProgram(parsed.program, ctxInput);`
All test callers do likewise (some via `.at(0)!`, e.g. evaluator/tests/interchange.test.ts:104).

Fix: return EvaluatedSchedule directly. There are no external consumers and compat shims are forbidden, so this is a mechanical signature change plus call-site updates. Note the contrast with `evaluateClauseGroups` (same file, lines 62-73), where the array is meaningful (one entry per THEN chain group) and should stay.

Related comment drift worth fixing in the same pass: packages/evaluator/src/resolve/index.ts:35-37 still describes "the per-statement MCP tools (`vestlang_evaluate` family, which map over statements separately)" — since 8d68357 the evaluate tools collapse the program (per-statement mapping survives only in the breakdown attribution pass).


---

**V3** · Provenance: **blind-hunt + differential** (vestigial, differential) — independent discoveries; the differential stream notes it as the one survivor of #200's sweep, now also growing surface (#210 added cliffDate).

## evaluateStatementAsOf (and its `prepare` helper) has no production caller — public surface sustained by one out-of-package test

**Category:** vestigial · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** Definition: packages/evaluator/src/asof.ts:63-77; exported at packages/evaluator/src/index.ts:8. The only consumer outside the evaluator is a test convenience: packages/pipeline/tests/summary.spec.ts:6 and :27 (building a VestedResult to feed computeSummary). Production as-of consumers all use evaluateProgramAsOf (packages/pipeline/src/run.ts:10/133/170). The helper `prepare` (packages/evaluator/src/utils.ts:9-13) exists solely to serve evaluateStatementAsOf (its one call site is asof.ts:67).

**Why it matters:** This is exactly the post-#200 stranded shape: a per-statement as-of entry kept on the package's public surface (knip-blind, since entry-file exports aren't reported) whose only remaining caller is another package's test; the program-level collapse made the per-statement partition obsolete because a THEN tail can't be partitioned alone (asof.ts:80-85 says so itself).

**Remedy:** Delete evaluateStatementAsOf and `prepare`; rewrite pipeline/tests/summary.spec.ts to build its VestedResult via evaluateProgramAsOf (the program in that test is single-statement, so the swap is one line). asof.ts then keeps only partitionAsOf + evaluateProgramAsOf.

**Details (issue-ready):**

`evaluateStatementAsOf` (packages/evaluator/src/asof.ts:63-77) partitions a single statement's tranches as of a date. The program-scoped evaluate model (commit 8d68357) made the program-level `evaluateProgramAsOf` the real entry — asof.ts:80-85 documents why per-statement partitioning is wrong for THEN chains — and every production consumer (pipeline runAsOf/runVestedBetween at packages/pipeline/src/run.ts:133 and :170, CLI and MCP via the pipeline) goes through the program version.

The statement version survives only because packages/pipeline/tests/summary.spec.ts:27 uses it as a fixture builder (`return evaluateStatementAsOf(program[0], context);`) for computeSummary tests. That cross-package test reference keeps it invisible to knip (and it sits on the evaluator's entry-file export surface, packages/evaluator/src/index.ts:8, where knip doesn't report unused exports by default).

Its private support structure goes with it: `prepare` (packages/evaluator/src/utils.ts:9-13) bundles createEvaluationContext + amountToQuantify and has exactly one caller, asof.ts:67 — note that evaluateProgramAsOf right below (asof.ts:91-96) calls those two pieces directly rather than through `prepare`, so the bundle has no second beneficiary.

Fix: delete evaluateStatementAsOf, delete `prepare`, switch summary.spec.ts to evaluateProgramAsOf (the fixture program there is a single statement, so behavior is identical), and drop the index re-export.


---

**V4** · Provenance: **blind-hunt** (vestigial).

## resolveStatements/buildTemplate take a `totalShares` parameter that every caller derives from the `ctx` they pass alongside

**Category:** vestigial · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** Signatures: packages/evaluator/src/resolve/lower.ts:385-389 (resolveStatements(program, ctx: EvaluationContext, totalShares: number)) and :526-530 (buildTemplate(resolutions, ctx: EvaluationContext, totalShares: number)). Both call sites compute it identically from the same ctx: packages/evaluator/src/resolve/index.ts:52-56 (`const totalShares = ctx.grantQuantity;` then passes ctx + totalShares to both) and packages/evaluator/src/resolve/interchange.ts:165-172 (`const totalShares = ctx.grantQuantity;` — interchangeCtx is `{...ctx, events: {}}`, same grantQuantity). EvaluationContext carries grantQuantity at packages/types/src/evaluation.ts:14. The duplication propagates into the TemplateBuild failure arms, which carry both ctx and totalShares as separate fields (lower.ts:531-545), read back together in classify.ts:126 and :169.

**Why it matters:** A parameter every caller passes the same derived value is pure skew surface: the type permits resolveStatements(program, ctx, n) with n ≠ ctx.grantQuantity, a state that has no meaning and that a future caller could create by accident, while the honest contract — shares come off the context — is already in the signature.

**Remedy:** Drop the totalShares parameter from resolveStatements and buildTemplate and read ctx.grantQuantity inside; drop the duplicated totalShares field from the TemplateBuild failure arms (classify already receives ctx there). The template-verdict's own totalShares field (carried into assemble.ts:70 for compileToInstallments) can stay if the verdict is meant to be self-contained — the duplication to remove is the parallel parameter/field alongside a ctx that already contains it.

**Details (issue-ready):**

Inside the resolve layer, share count travels twice. `resolveStatements` (packages/evaluator/src/resolve/lower.ts:385-389) and `buildTemplate` (lower.ts:526-530) each take both `ctx: EvaluationContext` and `totalShares: number`. EvaluationContext already has `grantQuantity: number` (packages/types/src/evaluation.ts:14), and both production call sites pass exactly that:
- packages/evaluator/src/resolve/index.ts:52-56 — `const ctx = createEvaluationContext(ctxInput); const totalShares = ctx.grantQuantity; ... resolveStatements(program, ctx, totalShares); buildTemplate(resolutions, ctx, totalShares);`
- packages/evaluator/src/resolve/interchange.ts:164-172 — same pattern; the events-blind `interchangeCtx = { ...ctx, events: {} }` preserves grantQuantity, so the invariant holds on that path too.

The duplication then rides into data: TemplateBuild's `unresolved` and `events` arms store both `ctx` and `totalShares` side by side (lower.ts:531-545), and classify.ts destructures both back out of the same object (:126, :169) — where they are, again, necessarily equal.

There is no call path in the repo where totalShares ≠ ctx.grantQuantity, so the parameter encodes a distinction that doesn't exist and invites one that shouldn't. Removing it shrinks two signatures, two object shapes, and the mental question "can these differ?" at every read site. The one defensible copy is the *template verdict's* totalShares (consumed by assemble.ts:68-72 to drive core's compile), since the verdict object deliberately doesn't carry a ctx — keep that, kill the parameter-level duplication behind it.


---

**V5** · Provenance: **blind-hunt** (vestigial).

## core's foldByCliffDate: a generic mapper instantiated exactly once — with the identity function — under a header describing callers that no longer exist

**Category:** vestigial · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/core/src/fold.ts:24-29 — `foldByCliffDate<T>(dates, amounts, cliffDate, fn)` with `fn` documented as "maps each emitted {date, amount} to the caller's installment shape." Its single non-test caller is foldToGrantDate in the same file, lines 84-88, which passes the identity: `({ date, amount }) => ({ date, amount })`. All production consumers use foldToGrantDate only: packages/core/src/kernel.ts:27 and :218-219, packages/evaluator/src/resolve/unresolved.ts:14, :96, :131. The header (fold.ts:5-8) says "The blocker/installment-producing callers stay in the evaluator" — but no evaluator code calls foldByCliffDate (verified by grep; only core/tests/fold.test.ts:2 does).

**Why it matters:** The generic parameter and `fn` callback are an option nothing varies — the installment-shaping callers the abstraction was built for were restructured away during the #194 date-math relocation, leaving a parameterized kernel whose only instantiation is the identity, exported only for its own tests.

**Remedy:** Collapse foldByCliffDate into foldToGrantDate (or keep foldByCliffDate but drop <T>/fn and return {date, amount}[] directly, with foldToGrantDate as the parallel-arrays adapter). Update fold.test.ts to test through the surviving function, and rewrite the stale header to describe the actual consumers (kernel.ts grant-date fold, evaluator's unresolved-arm folds via foldToGrantDate).

**Details (issue-ready):**

packages/core/src/fold.ts was ported in the #194 wave ("route all date math through @vestlang/core") from the evaluator's evaluateCliffGeneric/evaluateGrantDate pair. The port kept the generic shape: `foldByCliffDate<T>(dates, amounts, cliffDate, fn: (x: {date, amount}) => T): T[]` (lines 24-29), whose `fn` exists so callers could map emissions straight into their own installment shapes.

In the current tree that flexibility is unused:
- The only production call is foldToGrantDate, same file, lines 84-88 — instantiated at T = {date: OCTDate; amount: number} with the identity lambda.
- Every consumer of the fold goes through foldToGrantDate: packages/core/src/kernel.ts:218-219 (grant-date fold in allocateEvents) and packages/evaluator/src/resolve/unresolved.ts:96 and :131 (pre-grant and pre-cliff symbolic folds), which map to installment shapes *afterwards* (e.g. unresolved.ts:133-134) rather than via `fn`.
- foldByCliffDate's export is sustained only by packages/core/tests/fold.test.ts:2.

The header comment (fold.ts:5-8) still claims "The blocker/installment-producing callers stay in the evaluator; core only needs the aggregation" — true of foldToGrantDate, but it implies foldByCliffDate's mapper has evaluator callers, which it doesn't.

Fix: merge the two functions (drop <T> and `fn`, emit {date, amount}[] — or fold the loop directly into foldToGrantDate), retarget fold.test.ts, and update the header. One consideration: core is the package shipped to OCF-Tools, so if foldByCliffDate is intended as deliberate public engine surface for that consumer, say so in the header instead — but nothing in the repo or the function's own docs claims that today.


---

**V6** · Provenance: **blind-hunt** (vestigial).

## makeResolvedSchedule has zero production callers — kept alive only by its own unit test

**Category:** vestigial · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** Definition: packages/evaluator/src/evaluate/makeTranches.ts:52-60. Only references in the repo outside the defining file: packages/evaluator/tests/makeTranches.test.ts:5 and :17. Production code builds resolved installments via makeResolvedInstallment directly instead (packages/evaluator/src/resolve/assemble.ts:78-80, packages/evaluator/src/resolve/classify.ts:112 via makeResolvedInstallment in resolvedInstallments). Every sibling builder in the file (makeImpossibleSchedule, makeStartPlusSchedule, makeUnresolvedVestingStartSchedule, makeUnresolvedCliffSchedule/Installment) has live callers in resolve/unresolved.ts.

**Why it matters:** A dead builder sitting among five live ones misleads readers into thinking the resolved arm also routes through this module; the test reference makes it invisible to knip (test files count as project files under the default config).

**Remedy:** Delete makeResolvedSchedule and its describe-block in makeTranches.test.ts. makeResolvedInstallment (the piece production actually uses) stays.

**Details (issue-ready):**

packages/evaluator/src/evaluate/makeTranches.ts holds the installment builders for the symbolic arms plus `makeResolvedInstallment`. One of them, `makeResolvedSchedule(dates, amounts)` (lines 52-60), pairs dates/amounts into an InstallmentSet with empty blockers — and nothing in production calls it. The resolved paths construct installments directly:
- assemble.ts:78-80 maps core's compiled output through makeResolvedInstallment;
- classify.ts's resolvedInstallments (lines 103-112) maps allocateEvents output through makeResolvedInstallment.

Its only references are its own test (packages/evaluator/tests/makeTranches.test.ts:5, :17), which is what keeps knip quiet (the test file is part of the workspace's project files). The other builders in the file all have real callers in resolve/unresolved.ts (lines 52, 68, 75, 109, 117, 126, 128, 134), so this isn't a dead module — just one stranded export, most likely orphaned when the resolved arm was rebuilt around core's compile during the #194/#201 restructuring.

Fix: delete the function and its test block. If a paired-arrays helper is ever wanted again it's a three-line map.


---

**V7** · Provenance: **blind-hunt** (vestigial).

## Evaluator index over-exports the sidecar family relative to its actual consumer — under a comment that still says the family has no consumer

**Category:** vestigial · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/src/index.ts:13 — "Persistence / sidecar — no consumer today; its fate is an open Stage 5 decision" — followed by exports of rehydrate, reparseDefinition, RehydrateResult, toSidecar, Sidecar (lines 14-25). The actual consumer landed in #209: apps/mcp-server/src/persist.ts:15-22 imports only toPersisted, rehydratePersisted, fromSidecar, VESTLANG_SIDECAR_NAMESPACE, and type PersistedArtifact. No file outside the evaluator imports rehydrate, reparseDefinition, toSidecar, Sidecar, or RehydrateResult from the package (evaluator's own tests deep-import them from ../src/resolve/index, e.g. tests/rehydrate.test.ts:17, tests/sidecar.test.ts:21-25). rehydrate/reparseDefinition/toSidecar remain internally live (resolve/sidecar.ts:24/83/101, resolve/rehydrate.ts:116).

**Why it matters:** Half the exported persistence surface is API nobody calls through the package boundary (knip-blind: entry-file exports aren't reported), and the header comment's premise was falsified by #209 — a reader auditing the sidecar family today gets told it's consumerless when the persist/rehydrate MCP pair is its consumer.

**Remedy:** Rewrite the index comment to name the real consumer (the vestlang_persist/vestlang_rehydrate tool pair) and trim the re-export list to what crosses the boundary: toPersisted, rehydratePersisted, fromSidecar, VESTLANG_SIDECAR_NAMESPACE, PersistedArtifact (plus RehydrateResult if the persist tool's return type should be nameable by consumers). rehydrate/reparseDefinition/toSidecar/Sidecar stay internal to resolve/, where tests already reach them by deep import.

**Details (issue-ready):**

packages/evaluator/src/index.ts:13-25 exports the full sidecar/persistence family under the banner "Persistence / sidecar — no consumer today; its fate is an open Stage 5 decision." Both halves of that sentence are now stale: PR #209 added the vestlang_persist / vestlang_rehydrate MCP tool pair as the family's consumer, and the fate question was settled (the family stays).

Measured against that consumer, the export list splits cleanly:
- Used across the package boundary (apps/mcp-server/src/persist.ts:15-22): toPersisted, rehydratePersisted, fromSidecar, VESTLANG_SIDECAR_NAMESPACE, type PersistedArtifact.
- Exported but never imported from the package by anyone: rehydrate, reparseDefinition, type RehydrateResult, toSidecar, type Sidecar. Their only out-of-file references are evaluator-internal (sidecar.ts:101 calls rehydrate; rehydrate.ts:116 calls reparseDefinition; sidecar.ts:83 calls toSidecar) and the evaluator's own tests, which deep-import from ../src/resolve/index (tests/rehydrate.test.ts:17, tests/sidecar.test.ts:21-25) — the same deep-import convention #200 established when it un-exported other test-only surface.

Because these sit on the workspace entry file, knip's default config (no includeEntryExports) never flags them, so this is exactly the structurally-dead-but-referenced residue CI can't catch.

Fix: (1) replace the line-13 comment with one naming the MCP persist/rehydrate pair as the consumer; (2) drop rehydrate, reparseDefinition, toSidecar, Sidecar (and RehydrateResult, unless kept deliberately as the named return type of rehydratePersisted) from both packages/evaluator/src/index.ts and the resolve/index.ts re-export block (resolve/index.ts:162-171 keeps what its own package files import).


---

**V8** · Provenance: **blind-hunt** (type-model).

## SourceMapEntry.label is declared, documented, schema'd — and never written by anything

**Category:** vestigial · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/types/src/evaluation.ts:135-141 (declaration: "plus an optional display name"); the sole write site packages/evaluator/src/resolve/lower.ts:593 only ever sets `{ definition }`; apps/mcp-server/src/persist.ts:105-110 (zod SOURCE_MAP_ENTRY accepts `label` on the rehydrate input); repo-wide grep finds no other assignment

**Why it matters:** A dead optional on the published interchange-adjacent vocabulary: consumers (and the persisted-artifact zod contract) are told a display name may arrive, but no code path can produce one, so any consumer logic written for it is unreachable and the field only adds surface to keep in sync (it is already hand-mirrored into the MCP zod schema).

**Remedy:** Delete `label` from SourceMapEntry (and the zod mirror in persist.ts) per the no-compat-shims rule — or, if a human-readable name for synthetic events is genuinely wanted, mint one at externalization time in buildTemplate (lower.ts:587-596) and surface it in the view/sidecar.

**Details (issue-ready):**

## Summary

`SourceMapEntry` (packages/types/src/evaluation.ts:135-138) is `{ definition: string; label?: string }`, documented as "the DSL the synthetic `event_id` stands in for, plus an optional display name." The only place a source-map entry is ever constructed is `buildTemplate`'s `mintSynthetic` (packages/evaluator/src/resolve/lower.ts:587-595), which writes `sourceMap[eventId] = { definition }` — never a label. Nothing in packages/ or apps/ assigns `label` (verified by grep across the repo, excluding dist).

Meanwhile the field has leaked into contracts: the MCP server's persisted-artifact zod schema re-states it (`apps/mcp-server/src/persist.ts:105-110`), so a stored artifact may legally carry a label that no reader uses and no writer emits, and the sidecar docs (`packages/evaluator/src/resolve/sidecar.ts:5`) advertise `{ definition, label? }`.

This is the accreted-optional pattern in its simplest form: a field added for a future that hasn't arrived, now requiring hand-synced mirrors. Either delete it everywhere (types, sidecar comment, persist.ts zod) — there are no external consumers, and compat shims are forbidden — or make it real by minting a label at externalization time and rendering it in the view layer.


---

**V9** · Provenance: **differential**, with the same sites found blind by four hunter streams (vestigial, duplication, type-model, architecture). Additional stale-comment sites the hunters add to this sweep: the kernel-oracle test header (core/tests/kernel-oracle.test.ts:7-12, still describes the pre-#194 two-copies state); pipeline/run.ts:19-20 ('grantDate is injected into events' — false, harmless); the two remaining 'populated in a later phase' notes in packages/types (type-model stream); and resolve/index.ts:33-36 ('MCP tools map over statements separately' — program-scoped since 8d68357).

## Three in-code claims the fix wave falsified: sidecar "no consumer today", absenceAssumptions "emitted as an empty list for now", and "MCP tools map over statements separately"

**Category:** differential · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/src/index.ts:13 ("Persistence / sidecar — no consumer today; its fate is an open Stage 5 decision") vs apps/mcp-server/src/persist.ts:16-22 consuming toPersisted/rehydratePersisted/fromSidecar since #209. packages/types/src/evaluation.ts:296 ("(Populated in a later phase; emitted as an empty list for now.)") vs the live producer at packages/evaluator/src/resolve/assemble.ts:40-62 and populated output observed via vestlang_evaluate. packages/evaluator/src/resolve/index.ts:34-37 ("the per-statement MCP tools (`vestlang_evaluate` family, which map over statements separately…)") vs evaluateClauseGroups since #174 (packages/evaluator/src/evaluate/index.ts:62-73) — no MCP tool maps statements individually anymore.

**Why it matters:** Each is staleness someone would act on: the sidecar comment invites pruning a family that now has a shipped consumer (the vestlang_persist/vestlang_rehydrate pair); the AbsenceAssumption doc tells a consumer of the published .d.ts the field is always empty, so disclosure goes unwired; the cap-rationale comment describes a pre-#174 call pattern, misleading the next person who reasons about where the installment cap must be enforced.

**Remedy:** Three one-line comment fixes: (1) evaluator/src/index.ts — note the MCP persist/rehydrate pair as the consumer (per the settled decision the family stays); (2) types/evaluation.ts — delete the "(Populated in a later phase; emitted as an empty list for now.)" parenthetical; (3) resolve/index.ts — reword the cap rationale around evaluateClauseGroups (per-chain resolution still needs the program-wide cap check; the reason survives, the description of who calls what doesn't).

**Details (issue-ready):**

## Stale in-code claims left behind by the fix wave

Per CLAUDE.md §2/§6, code comments are not authority — but these three actively misdirect, and each sits exactly where the next change will be decided:

1. **packages/evaluator/src/index.ts:13** — `// Persistence / sidecar — no consumer today; its fate is an open Stage 5 decision.` PR #209 (07a5ebd) shipped the consumer: apps/mcp-server/src/persist.ts imports `toPersisted`, `rehydratePersisted`, `fromSidecar`, `VESTLANG_SIDECAR_NAMESPACE` (lines 16-22) behind the vestlang_persist / vestlang_rehydrate tools. The round-1 report's "land a consumer or prune" question is resolved; the comment still poses it. A reader acting on it could prune a shipped surface.

2. **packages/types/src/evaluation.ts:296** — AbsenceAssumption's doc ends "(Populated in a later phase; emitted as an empty list for now.)" The later phase landed: `collectAbsences` (packages/evaluator/src/resolve/assemble.ts:40-62) populates it on every evaluation, and live output confirms (e.g., a gated-cliff program returns `absenceAssumptions: [{eventId: "board", through: "2026-01-01"}]`). This is the published .d.ts consumers read; "always empty" tells them not to wire absence disclosure. (Adjacent to, but distinct from, open issue #102 about over-recording bare pending events.)

3. **packages/evaluator/src/resolve/index.ts:34-37** — the installment-cap rationale says the measure backs "the per-statement MCP tools (`vestlang_evaluate` family, which map over statements separately…)". Since #174 the family runs through `evaluateClauseGroups` (packages/evaluator/src/evaluate/index.ts:62-73), which asserts the cap once over the whole program and resolves THEN chains as units; nothing maps statements separately. The cap's placement is still right — the justification text describes a deleted call pattern.

All three are doc-only fixes; no behavior change.


---

**V10** · Provenance: **blind-hunt** (bugs-apps) — MCP tool descriptions are behavioral contract for LLM clients; fix alongside the infer tool's 'Always round-trip verified' overclaim noted in that stream's notes.

## vestlang_evaluate tool description understates the 'unrepresentable' verdict: claims 'today only an event-anchored cliff' but three causes exist

**Category:** vestigial · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** apps/mcp-server/src/server.ts:317 ('"unrepresentable" (no storable form even as bare events — today only an event-anchored cliff)'); packages/types/src/evaluation.ts:250-256 ('Three causes today: … EVENT_CLIFF … DEFERRED_CLIFF … EVENT_CHAINED_TAIL'); packages/evaluator/src/resolve/interchange.ts:141-150 (unresolved builds map to unrepresentable with all three reasons)

**Why it matters:** Tool descriptions are the behavioral contract LLM clients act on; `VEST FROM EVENT ipo OVER 1 YEAR EVERY 6 MONTHS THEN VEST OVER 1 YEAR EVERY 6 MONTHS` returns interchange=unrepresentable with the EVENT_CHAINED_TAIL reason (verified), which the description says cannot happen — a client may mis-explain or mis-handle the verdict.

**Remedy:** Update the description string in server.ts to enumerate the three causes (event-anchored cliff, deferred cliff, THEN tail behind an event-waiting head), mirroring the InterchangeVerdict doc in types/evaluation.ts.

**Repro:**
```
mcp__vestlang__vestlang_evaluate {"dsl":"VEST FROM EVENT ipo OVER 1 YEAR EVERY 6 MONTHS THEN VEST OVER 1 YEAR EVERY 6 MONTHS","grant_date":"2025-01-01","grant_quantity":100} → interchange.status "unrepresentable" with the EVENT_CHAINED_TAIL reason text.
```

**Details (issue-ready):**

## Summary

The `vestlang_evaluate` tool description (apps/mcp-server/src/server.ts:317) says the interchange verdict `"unrepresentable"` arises "today only [for] an event-anchored cliff". The code disagrees: packages/types/src/evaluation.ts:250-256 documents three causes (EVENT_CLIFF, DEFERRED_CLIFF, EVENT_CHAINED_TAIL), and packages/evaluator/src/resolve/interchange.ts:48-64,141-150 produces all three.

Empirically:
- `VEST FROM EVENT ipo OVER 1 YEAR EVERY 6 MONTHS THEN VEST OVER 1 YEAR EVERY 6 MONTHS` → unrepresentable, "A THEN segment chained behind a start waiting on event \"ipo\" …" (EVENT_CHAINED_TAIL)
- `VEST FROM DATE 2025-01-01 OVER 1 YEAR EVERY 6 MONTHS CLIFF EVENT ipo` → unrepresentable, EVENT_CLIFF

Since MCP clients (LLMs) read the description as the spec, the stale claim invites wrong explanations of a verdict that occurs for common chained-event schedules. One-line doc fix in the registerTool call; consider also auditing the rest of that long description against the current verdict vocabulary while touching it.


---

**V11** · Provenance: **blind-hunt** (bugs-dates).

## date_diff(months): the negative-direction 'clamp' is provably a no-op, and the #205 comment claims it's load-bearing in both directions

**Category:** vestigial · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** apps/mcp-server/src/date-math.ts:80 (Math.min(fd, daysInMonth(fy, fm)) — fd is from's own day in from's own month, so fd <= daysInMonth(fy, fm) always and the min is always fd); apps/mcp-server/src/date-math.ts:60-65 (comment: 'Compare against the clamped day in both directions').

**Why it matters:** Harmless today (I verified the negative direction is behaviorally correct: with td <= daysInMonth of to's month, td > fd is equivalent to td > min(fd, daysInMonth(target month)) in all cases), but the comment asserts a clamp that doesn't exist, so the next editor 'fixing' it to clamp against a different month could change behavior while believing they're completing #205.

**Remedy:** Either drop the vacuous min() in the direction === -1 branch (condition is exactly td > fd) and correct the comment to explain why the backward direction needs no clamp, or clamp against the actual target month daysInMonth(ty, tm) with a comment proving equivalence — plus a pinned test like date_diff('2025-04-30','2025-03-31') = {0, -30} / date_diff('2025-05-31','2025-02-28') = {-3, 0}.

**Repro:**
```
mcp__vestlang__vestlang_date_diff {"from": "2025-02-28", "to": "2025-01-31", "unit": "months"} → {"diff":0,"remainder_days":-28} (correct and consistent with add_period(2025-02-28, -1, months) = 2025-01-28; the point is the code's min() never alters this)
```

**Details (issue-ready):**

## Summary

PR #205 made `dateDiff(months)` agree with `add_period` on month-end clamps; the comment (apps/mcp-server/src/date-math.ts:60-65) says the clamped stepped day is compared "in both directions". The positive direction genuinely clamps: `Math.min(fd, daysInMonth(ty, tm))` uses the TARGET month. The negative direction (line 80) computes `Math.min(fd, daysInMonth(fy, fm))` — `fd` is `from`'s own day in `from`'s own month, so `fd <= daysInMonth(fy, fm)` by construction and the `min` always evaluates to `fd`. The expression is dead weight.

Is the negative direction therefore wrong? No — I worked the cases: the correct backward test is `td > min(fd, daysInMonth(ty, tm))` (the day add_period would land on stepping back into to's month). When `fd >= daysInMonth(ty, tm)`, the correct condition can never fire because `td <= daysInMonth(ty, tm)`; the code's `td > fd` can't fire either (td <= dim(tm) <= fd). When `fd < daysInMonth(ty, tm)`, both reduce to `td > fd`. Equivalent everywhere; spot-checked empirically (Feb 28→Jan 31 = 0m −28d; Apr 30→Mar 31 = 0m −30d; May 31→Feb 28 = −3m 0d; Mar 15→Jan 20 = −1m −26d, all matching add_period stepping).

So: behavior fine, comment false, expression misleading. Worth a two-line cleanup with a pinned test so the next #205-style fix doesn't 'complete' a clamp that must stay vacuous. (Also worth noting in the same file: date-math.ts:43-47 re-implements daysInMonth that @vestlang/utils already exports in a different form — packages/utils/src/dates.ts:12-19 — a small duplication to fold if touched.)



# Architecture

This stream ran report-blind but with permission to challenge round 1's settled layout. Its overall read: it didn't need to. The package carving holds up under fresh measurement, and the two-verdict model is **enforced by construction** — `resolveInterchange` runs the identical lowering against an events-blanked context (`interchange.ts:168`), so firing-invariance is structural, not asserted; the stream also verified by grep that the resolution layer never reads `asOf` (only `asof.ts` partitions by it), making the interchange verdict clock-invariant as claimed. The selector layer's policy-table design (`selectors.ts:100-119`) and exhaustiveness tripwire are the right shapes.

The headline deliverable — the deferred `resolve/` split — gets a concrete answer below (AR1): **don't split into a package; do a two-file move.** The import boundary was measured exhaustively: six resolve→evaluate crossings (all into the expression-interpreter subset), exactly one evaluate→resolve crossing (the orchestrator), no cycle.

Cleaner factorings that would retire classes of the hunters' findings: AR2 (the `StmtResolution` remodel — would have made B2/B3 unrepresentable, see also M1), AR3 (one source of truth for gate strictness — retires a reopened bug class), and two cross-referenced from other categories: B4's namespace fix (collision unrepresentable by construction) and D1/A1 (the day-of-month constant and the pipeline-owns-orchestration rule, both of which the architecture stream independently derived).

One below-bar observation worth recording: a single MCP evaluate call lowers the program ~6 times (resolveToCore + resolveInterchange + 2 per THEN chain in the breakdown, plus recovery's re-evaluate). Irrelevant at current scale; becomes real if programs grow or the server goes hot-path. Also: `assemble(resolution, interchange)` accepts any pair — nothing ties the two verdicts to the same program/context at the type level; benign today with exactly one caller.

---

**AR1** · Provenance: **architecture** (report-blind). The headline deliverable: the deferred resolve/ split, answered with the measured import graph.

## Deferred resolve/ split — verdict: don't split into a package; the import graph is already a clean 3-layer DAG, but two files sit in the wrong layer

**Category:** architecture · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** Crossings resolve→evaluate: lower.ts:37-38, cliff.ts:30-36, rehydrate.ts:30-31, classify.ts:29, unresolved.ts:16-23, assemble.ts:23-25. Crossing evaluate→resolve: evaluate/index.ts:11-12 (the only one). Entry layer: src/index.ts:2-25, src/asof.ts:8-9. Consumers (all import whole-evaluation symbols only): packages/recover/src/recover.ts:1, packages/pipeline/src/run.ts:10, packages/inferrer/src/installments.ts:1, packages/inferrer/src/verify.ts:1, apps/mcp-server/src/persist.ts:15-22, apps/mcp-server/src/date-math.ts:2, packages/vestlang/src/index.ts:11

**Why it matters:** The deferred question has a concrete answer: there is no cycle and no entanglement, so a package split stays a mechanical option — but splitting today re-exposes the internal surface #200 deliberately un-exported, adds a build target, and serves zero consumers, while the real legibility problem is just that the orchestrator and the assembler live in directories that invert the layering.

**Remedy:** Keep one package. Move evaluate/index.ts (the 90-line orchestrator) up to src/ and move resolve/assemble.ts next to it; the directories then read as honest layers (interpreter ← lowering ← orchestration) and a future package cut falls out mechanically. Name the split trigger explicitly: a real external consumer of the lowering alone (e.g. OCF-Tools wanting DSL→template without evaluation), which would also force a CJS build the way core ships one.

**Details (issue-ready):**

## The measured boundary

Every import crossing the resolve/ ↔ evaluate/ boundary, both directions:

**resolve → evaluate (6 files, all into the expression-interpreter subset):**
- `lower.ts:37-38` → `evaluateScheduleExpr` (selectors), `isPickedResolved` (utils)
- `cliff.ts:30-36` → `evaluateVestingNodeExpr` (selectors); `isPickedResolved`, `probeLaterOf`, `PickReturn` (utils); `isVestingStartPlaceholder`, `CliffEvaluationContext` (vestingNode/vestingBase)
- `rehydrate.ts:30-31` → `evaluateVestingNodeExpr` (selectors); `isPickedResolved`, `PickReturn` (utils)
- `classify.ts:29` → `makeResolvedInstallment` (makeTranches)
- `unresolved.ts:16-23` → makeTranches installment constructors
- `assemble.ts:23-25` → `makeResolvedInstallment` (makeTranches), `foldBlocker` (blockerTree), `isVestingStartPlaceholder` (vestingNode/vestingBase)

**evaluate → resolve (exactly one file):**
- `evaluate/index.ts:11-12` → `resolveToCore`, `resolveInterchange`, `assertProgramInstallmentCap` (resolve/index), `assemble` (resolve/assemble)

None of the evaluate/ files that resolve/ imports (selectors, utils, makeTranches, blockerTree, blockerToString, boundary, time, vestingNode/*) import anything from resolve/. So the file-level graph is a strict 3-layer DAG:

1. **Expression interpreter** (~770 lines of evaluate/): selector folds, gate/constraint semantics, blocker trees, installment constructors. Depends only on types/core/utils/render.
2. **Lowering + classification** (resolve/, ~2.2k lines): resolveStatements/buildTemplate/lowerCliff/classify/interchange/rehydrate/sidecar. Depends on layer 1.
3. **Orchestration** (evaluate/index.ts 90 lines, asof.ts 107, index.ts 25): `assemble(resolveToCore(...), resolveInterchange(...))`. Depends on layer 2.

## What's actually wrong

The *directory* boundary inverts the layering twice: the top-layer orchestrator lives inside `evaluate/` (whose other files are the bottom layer), and `assemble.ts` — by its own header "the last stage of the extended pipeline" — lives inside `resolve/` though only the orchestrator imports it. The package's own entry comment compounds the confusion: `src/index.ts:1` labels the evaluate exports "the compiler's public API", muddling exactly the compiler/runtime seam CLAUDE.md §4 says matters. Note also that the conceptual seam is *not* resolve-vs-evaluate as named: `resolveToCore` is the closed-world resolution (reads firings) and `resolveInterchange` is the firing-invariant compile — both live in resolve/ and share `buildTemplate`; "evaluate/" is mostly the expression interpreter both of them call.

## Verdict

**Don't split now.** Costs of a split today: (a) the lowering's surface (`resolveToCore`, `resolveInterchange`, `StmtResolution`, `TemplateBuild`, the interpreter symbols) becomes public API again — re-expanding exactly what #200 deliberately un-exported; (b) another build/package boundary; (c) all 7 consumer files churn — and every consumer (recover, pipeline, inferrer ×2, mcp-server ×2, umbrella) imports only whole-evaluation entry points, so nobody gains anything. Benefit deferred until a consumer of the compiler-alone exists; the named trigger is OCF-Tools (or another external) wanting DSL→template without evaluation, which would also force a CJS build for the compiler package per the repo's CJS-only-for-external-consumers rule.

**Do the two-file move** (evaluate/index.ts → src/, resolve/assemble.ts → src/ beside it, or an explicit `interpret/` dir for the bottom layer). After it, the directory dependency is strictly one-way and the future split is `git mv` plus a package.json.


---

**AR2** · Provenance: **architecture + blind-hunt** (type-model found the same disguised-DU independently as StmtResolution's co-varying chained?/origin? optionals).

## StmtResolution leans on positional parallel arrays and a mirrored `chained` flag — carry the statement and model head/tail as a DU

**Category:** architecture · **Confidence:** medium · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/src/resolve/classify.ts:130-131 and 173-174 (program.forEach((stmt, i) => { const r = resolutions[i]; ... }) — alignment by index, twice); lower.ts:135-146 (chained?: boolean and origin?: OCTDate as optional fields, with comment-enforced invariants "set only on tails" / "Absent on a non-tail"); interchange.ts:80 reads r.chained while classify.ts:182 and unresolved.ts:43 read stmt.chained — two copies of one fact; classify.ts:50 (r.origin ?? anchor fallback)

**Why it matters:** The compiler's central IR record is correlated with its source statement only by array position, and chained-ness lives in two places (Statement and StmtResolution) read inconsistently across three files; both are convention-enforced invariants in exactly the seam where the fix wave clustered (#180, #181, #184, #196, #210, #211 all touched StmtResolution's shape or its consumers).

**Remedy:** Have resolveStatements return Array<{ stmt: Statement; resolution: StmtResolution }> (or put stmt on the record), deleting the program.forEach/resolutions[i] zip and the mirrored flag — chained-ness is then read off one place. Model the chain role as a DU: chain: { role: "head" } | { role: "tail"; origin: OCTDate }, making "origin on a head" and "tail without origin" unrepresentable and removing the ?? fallback.

**Details (issue-ready):**

## Current shape

`resolveStatements` (lower.ts:385-486) returns `StmtResolution[]` positionally parallel to the input `Program`. Both classifier arms then re-zip by index: `classify.ts:130-131` (`eventsArm`) and `classify.ts:173-174` (`unresolvedArm`) do `program.forEach((stmt, i) => { const r = resolutions[i]; ... })`. Nothing in the types ties `r` to `stmt`; the invariant "exactly one resolution per statement, in order" is enforced only by the shape of the loop in resolveStatements.

Chained-ness is stored twice: `Statement.chained` (the AST) and `StmtResolution.chained` (set by the walk, lower.ts:139). Consumers split: `interchange.ts:80` and lower.ts:652 read `r.chained`; `classify.ts:182` and `unresolved.ts:43` read `stmt.chained`. They agree today because the walk copies the flag — a refactor that breaks the copy breaks them silently and differently.

`origin` (lower.ts:140-146) is optional with the invariant "set only on tails"; `classify.ts:50` papers over the head case with `r.origin ?? anchor`. An accidental `origin` on a head, or a tail missing one, typechecks fine and shifts the day-of-month grid — precisely the bug class the month-end fixes (#194 cursor work, the origin-threading in #174's chain-aware breakdown) were about.

## Why this seam, why now

The churn map shows the fix wave concentrated here: #180 (offsets across the lowering boundary — a new optional field `offsetExpr`), #181 (structured non-template reason), #184 (event cliff behind pending start), #196 (RESOLVED start base became a DU — the same medicine, applied to a sibling field), #210/#211. Each fix added or re-read a field on this record. #196 already demonstrated the payoff of DU-ifying one corner; this finding is the same move for the chain-role corner plus the stmt linkage.

## Sketch

```ts
interface StmtResolution {
  stmt: Statement;            // or return Array<{stmt, resolution}>
  percentage: Fraction;
  periodicity: ...;
  start: ...;                 // unchanged DU
  cliff: LoweredCliff;
  chain: { role: "head" } | { role: "tail"; origin: OCTDate };
}
```
Deletes: both forEach zips, the mirrored flag, the `?? anchor` fallback, and the lower.ts:140-146 comment block explaining the convention.


---

**AR3** · Provenance: **architecture + blind-hunt** (abstraction) — independent discoveries.

## BEFORE/AFTER strictness semantics implemented twice — evaluator's failByRelation and the linter's window rule keep parity by comment

**Category:** architecture · **Confidence:** high · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/src/evaluate/vestingNode/constraint.ts:28-49 (failByRelation: bare BEFORE = subject <= base, STRICTLY = strict); packages/linter/src/rules/unsatisfiable-date-window.ts:60-64 (comment: "matching the evaluator's failByRelation semantics exactly"), 70-74 (independent re-derivation of the bound mapping), 98-102 (isEmpty re-encodes the strict/non-strict day arithmetic)

**Why it matters:** Two packages now independently encode what a bare vs STRICTLY gate means; if they drift, the linter will bless gates the evaluator poisons (or flag live ones) — and this exact seam has churned before (#113/#116 per the note at resolve/cliff.ts:66-69, plus the clock-invariant-gates rework in a5a517f), so a second hand-rolled copy re-opens a closed bug class.

**Remedy:** Lift the relation primitive into @vestlang/core, which both packages already depend on and which owns date semantics since #194 — e.g. `satisfiesRelation(relation, strict, subject, base)` (the inverse of failByRelation) plus, optionally, a window-intersection/emptiness helper. constraint.ts and unsatisfiable-date-window.ts both consume it; the linter comment promising parity is replaced by shared code.

**Details (issue-ready):**

## The duplication

The evaluator decides whether a gate is violated in `failByRelation` (packages/evaluator/src/evaluate/vestingNode/constraint.ts:28-49): bare `BEFORE` is non-strict (`subject <= base` passes), `STRICTLY BEFORE` is strict, mirrored for `AFTER`.

The new lint rule from #212 (packages/linter/src/rules/unsatisfiable-date-window.ts) re-derives the same semantics by hand: the `windowsOf` mapping at lines 70-74 (AFTER → lower bound, BEFORE → upper bound, strictness carried), and `isEmpty` at lines 98-102 (`daysBetween(lower, upper) < (lower.strict ? 1 : 0) + (upper.strict ? 1 : 0)` — the day-granularity encoding of the same comparison). The rule's own comment (lines 60-64) says it matches "the evaluator's failByRelation semantics exactly" — parity by promise, enforced by nothing.

## Why the linter can't just import the evaluator

Deliberate and correct: linter depends on {core, dsl, normalizer, types, utils, walk} only — importing the evaluator would drag the whole compiler into static analysis. But both already depend on **core**, and #194's principle ("route all date math through core") extends naturally to date-*relation* semantics: a strict/non-strict comparison over OCTDates is exactly the kind of primitive core exists to own (it already exports `lt`/`eq`/`gt`/`daysBetween`).

## Concrete risk removed

The gate seam is historically the evaluator's most-fixed area: the violated/pending/satisfied split drifted between the two cliff paths (#113/#116, per resolve/cliff.ts:66-69), and gates were reworked again for clock-invariance (a5a517f). A future tweak to strictness or boundary handling in the evaluator that doesn't visit the linter (or vice versa) produces a linter that contradicts the engine — the worst kind of lint. One shared predicate in core makes that drift impossible.

## Sketch

```ts
// core
export const satisfiesRelation = (
  relation: "BEFORE" | "AFTER", strict: boolean,
  subject: OCTDate, base: OCTDate,
): boolean => ...;
```
constraint.ts:131 calls `!satisfiesRelation(...)`; the linter's `windowsOf`/`isEmpty` either consume it directly (probe the boundary days) or core also exports the tiny Bound/intersect/isEmpty trio, which is pure date math with no AST dependency.


---

**AR4** · Provenance: **architecture** — grounded future-proofing per CLAUDE.md §4's open contingency questions.

## Future-proofing: a template-expressible event cliff is one schema arm away — the projection kernel already does the math

**Category:** architecture · **Confidence:** medium · **Verifier:** confirmed (novel)

**Evidence:** packages/core/src/kernel.ts:48-51 (GridCliff already has the { kind: "proportional"; date } arm); packages/evaluator/src/resolve/classify.ts:67-75 (fired event cliffs already project through it today); the sites that gate it out: types/canonical.ts:66-75 (Cliff is duration-only), core/compile.ts:60-71 (Cliff→GridCliff mapping, fixed-date only), evaluator/resolve/cliff.ts:38-60 + 147-166 + 300-301 (EVENT state routed away), lower.ts:561-575 (buildTemplate guards), interchange.ts:48-64 + 132-137 (EVENT_CLIFF → unrepresentable), apps/mcp-server/src/persist.ts:56-62 (CLIFF zod)

**Why it matters:** CLAUDE.md §4 names the event cliff as the expressiveness seam's open question; the cost map shows the engine half is already built (the events arm projects fired event cliffs through the proportional GridCliff today), so the real cost is schema + routing — and the documented cliff-shape drift with OCF-Composed-Schemas means the wire shape is being re-decided anyway, making this the cheap moment to decide the Cliff union once instead of re-aligning twice.

**Remedy:** If/when the Carta answer permits it: make canonical Cliff a DU — { length, period_type, percentage } | { event_id } — and map the event arm in core's compile to { kind: "proportional", date: firing } (unfired → withhold the statement, mirroring compile.ts:129's unfired EVENT base). Then lowerCliff/lowerDeferredCliff return RESOLVED for event cliffs, the buildTemplate guards and the EVENT_CLIFF→unrepresentable mapping drop, and unresolvedReason's precedence dance simplifies. If the answer is no, record that decision at cliff.ts:38-60 so the EVENT record state stops reading as provisional.

**Details (issue-ready):**

## The asymmetry worth knowing about

An event-anchored *start* is template-expressible (EVENT vesting_base); an event-anchored *cliff* is not — it routes to `unresolved`/`events-only` (lower.ts:561-575) and the interchange verdict calls it `unrepresentable` (interchange.ts:132-137). CLAUDE.md §4 frames this as the open expressiveness question. What the code shows, and what's worth writing down, is **how little of the engine actually enforces it**:

- The shared grid kernel already models an event-shaped cliff: `GridCliff` has a `{ kind: "proportional"; date }` arm (core/kernel.ts:48-51) — "the lump takes whatever share of the grid lands at or before its effective date", which is exactly event-cliff semantics with the firing as the date.
- That arm is **exercised in production today**: `classify.ts:67-75` projects a *fired* event cliff through it on the events-only path. The math, allocation, and grant-date fold all already work.
- The lowering already carries the event cliff as a structured record (`LoweredCliff`'s `EVENT` state with `effectiveAt`, cliff.ts:38-60) rather than an error.

## Full cost map (every site that changes)

1. **types/canonical.ts:66-75** — `Cliff` becomes a DU: duration arm | `{ event_id: string }` arm (decide whether the event arm carries its own `percentage` or stays proportional-only).
2. **core/compile.ts:60-71** — `expandAnchored` maps the event arm: firing found → `{ kind: "proportional", date: firing.date }`; unfired → return no events for the statement (the "withheld, never released" failure mode, same as compile.ts:129's unfired EVENT base).
3. **core/validate.ts** — cliff validation grows the arm.
4. **evaluator/resolve/cliff.ts:147-166, 300-301** — lowerCliff/lowerDeferredCliff return `RESOLVED` with the event arm instead of the routed-away `EVENT` state; the state itself may survive only for gated cases.
5. **lower.ts:561-575** — the two buildTemplate guards (unfired event cliff → unresolved; fired → events) drop.
6. **interchange.ts:48-64, 132-137** — `EVENT_CLIFF` stops meaning unrepresentable; `unresolvedReason`'s precedence ordering loses a case.
7. **apps/mcp-server/src/persist.ts:56-62** — the CLIFF zod schema.
8. **Cross-repo**: OCF-Composed-Schemas' canonical cliff — which per CLAUDE.md already drifts (occurrence-based there vs date-based here, alignment issue open). Deciding the cliff as a union *once*, while that alignment is in flight, costs less than aligning to date-only now and re-opening for the event arm later.

## Caveat

This is a costed option, not a recommendation to build now — CLAUDE.md §4 is explicit that whether canonical should keep expressing contingency is open and gated on the Carta question. The finding is that the price tag is small and mostly schema-side, which is itself decision-relevant input to that question.


---

**AR5** · Provenance: **architecture** — grounded future-proofing; maps the blast radius of the open Carta question.

## Future-proofing: if the EVENT vesting_base must narrow (open Carta question), the routing absorbs it cheaply — the persistence family is the real casualty

**Category:** architecture · **Confidence:** medium · **Verifier:** confirmed (novel)

**Evidence:** packages/evaluator/src/resolve/lower.ts:110-128 (PENDING_EVENT / SYNTHETIC_EVENT start states) and 606-655 (the EVENT vesting_base emission + firing recording in buildTemplate); interchange.ts:160-175 (events-blind resolution makes every event start ride the template verdict); the dependents whose premise is unfired-EVENT templates: resolve/sidecar.ts:1-20, resolve/rehydrate.ts:1-18, apps/mcp-server/src/persist.ts (entire file, ~286 lines, the #209 tool pair)

**Why it matters:** CLAUDE.md §4 flags that the EVENT base and events-only fallback may have to narrow if Carta can't hold a contingent start; the blast radius is worth mapping now because the persistence/rehydrate family — which just gained its consumer in #209 — exists precisely to carry unfired-EVENT templates, so every new consumer of sidecar semantics grown before the Carta answer lands increases the demolition cost if the answer is no.

**Remedy:** No code change today. Treat the map as the contingency plan: the narrowing itself is routing-level (the three lower.ts arms re-route to the existing events/unresolved verdicts; interchange's mapTemplateBuild flips event-anchored starts from "template" to "unrepresentable"/"events-only"), the interpreter and classifier arms are untouched — but rehydrate/sidecar/persist lose their reason to exist for contingent starts. Concretely: keep the persistence family's consumer count at one (the MCP pair) until the Carta question resolves, and note that coupling at the family's doorstep (sidecar.ts header) rather than only in docs/scratch.

**Details (issue-ready):**

## What the narrowing would mean mechanically

If Carta cannot hold a grant with a contingent start, the canonical EVENT `vesting_base` (types/canonical.ts:56-59) can no longer carry an *unfired* event, and the lowering arms that today produce template verdicts for pending starts have to re-route:

- **lower.ts:110-128** — the `PENDING_EVENT` and `SYNTHETIC_EVENT` start states currently "lower into the template rather than poisoning the program"; both would instead route to the `unresolved` build (one-line changes in buildTemplate's dispatch at lower.ts:606-617).
- **interchange.ts** — the firing-blind resolution means *every* event-anchored start reads as unfired there, so today they all produce `template` interchange verdicts (verified empirically: the repro program above returns `interchange.status: "template"` with two unfired events). Narrowing flips these to `unrepresentable`/`events-only` in `mapTemplateBuild` (interchange.ts:102-152). Fired-event statements could plausibly survive as templates (the firing is on record), which would keep lower.ts:623-655 alive.
- **Untouched**: the expression interpreter (selectors/vestingNode), the events/unresolved classifier arms (classify.ts), and core's compile — the fallback representations already exist, which is the structural good news. The two-verdict model (CLAUDE.md §4) absorbs the change by design: only the `interchange` floor moves.

## The real cost center

The persistence family exists to carry templates with unfired events across a storage boundary: sidecar.ts's own header ("the carrier for a template that holds synthetic events"), rehydrate.ts ("turn a stored canonical artifact + the world's firings into synthetic-event witnesses"), and the #209 MCP pair (persist.ts, ~286 lines + tests). If contingent starts become unrepresentable, `vestlang_persist` would reject most of what it exists for, and rehydration's witness computation loses its subject. That's not a reason to remove the family (the settled decision keeps it, and it has a consumer) — it's a reason to (a) keep its consumer surface at exactly one until the Carta answer lands, and (b) state the coupling in sidecar.ts's header so the dependency on the open question is visible at the code site, per the repo's own provenance-hygiene rule (§6: the open question currently lives only in docs/scratch/carta-vesting-open-questions.md, which is ephemeral by policy).



---

# Differential

The auditor read the round-1 report and the #174–#209 diffs, then checked the tree. Its findings are already placed above (B1 = the regression-shaped survivor, B8 = the regression proper, B20, V3, V9); what follows is the whole-stream judgment.

**The wave landed cleanly.** Every consolidation greps as fully adopted: `stableKey` lives once in utils (#186); `blockerToString` delegates condition rendering to render's printer (#185); the inferrer shares one `residual.ts` kernel with a single EPSILON (#188/#190); `systemAnchorOffset` is in walk and used at all three round-1 sites (#187); `classifyAllocation`/`formatPct` are shared by evaluator, pipeline, and linter (#189); all day-diff math routes through core (#194); makeTranches uses the shared scaffold (#191); the five round-1 type remodels are in; the declared-dependency fictions are fixed. Empirical re-tests of the round-1 repros against the live server confirm B1–B6, B12, #205, #210, #211 (round-1 numbering) all hold.

**The residual defect shape:** a fix applied to one arm of a symmetric pair while the sibling kept the old behavior — events arm vs template arm (B1), negative vs over-1 percentage (below) — plus one genuinely new defect in the freshest follow-up (B8, #212's exponential rule).

**Checked and deliberately open (not findings):**
- **core `compile()` accepts statement percentage > 1** and allocates 150 of a 100-share grant. This is the over-grant half of round-1 B8; PR #177 explicitly deferred the upper bound to the findings channel (contingent EVENT branches can legitimately sum above 1), pinned by a core test. The verifier upheld the deferral but flagged the residue: the findings-channel rationale only serves the evaluator path — direct core consumers (OCF-Tools is the intended one) get silence. A design follow-up, not a regression; B6 (persist ignoring findings) is where the deferral currently leaks into a stored artifact.
- **evaluator's `evaluate/time.ts`** one-function adapter — the documented end-state round 1 prescribed for #194; re-litigation killed in verification.

**Stale round-1-report claims** (for anyone still reading `docs/scratch/codebase-review-report.md`): §6's evaluator anatomy is obsolete — presentation (~540 lines) now lives in pipeline (#201), the friend API is deleted, the date re-export hub is gone, `evaluateStatementsAsOf` no longer exists; §6's "sidecar consumed only by its own tests" is false since #209. The report file is the round's only remaining `docs/scratch` artifact.

**Round-1 context on the `resolve/` split (handover honored — verdict was the architecture stream's, above at AR1):** round 1 deferred the split behind three seam symptoms (the friend API, the core-date re-export hub, pipeline straddling evaluation + presentation) plus the sidecar lacking a consumer. Every named precondition has since moved: #181 put the structured reason on the published type, #194 killed the date hub, #200/#201 deleted the friend API and evicted presentation, #209 gave the sidecar its consumer. The split question was therefore genuinely ripe — and AR1 answers it on the merits rather than on the preconditions.

---

# Test-adequacy map

Whole-suite judgment (suite verified green, 26/26 turbo tasks), per domain-critical path: where the suite would stay green under a behavior change, and the invariant test that would catch it.

1. **Date arithmetic — strong.** `core/tests/dates.test.ts` pins all four day-of-month policy families, the chain-origin parameter (including clamp-then-spring-back Jan 31 → Feb 28 → Mar 31), DST/leap stepping, and overflow rejections; `mcp-server/tests/date-math.test.ts` (grown by #205) pins add_period/date_diff inversion and monotonicity. Residual softness: the #205 inversion promise holds only under the *default* day-of-month rule (date_diff's remainder anchor hard-codes it while add_period accepts any rule), and the provably-vacuous reverse-direction clamp (V11) invites a wrong "fix."

2. **Integer allocation / share conservation — primitives strong, invariant absent.** `allocate.test.ts` (incl. BigInt-range telescoping), `kernel.test.ts`, and two kernel-oracle files pin compile outputs case by case, but conservation as a *property* exists only as one events-arm assertion. Both live as-of accounting bugs (B1, B2) sit exactly in the untested arms. **Invariant test: T1** — vested + unvested + unresolved + impossible === grant, asserted across every arm of every verdict, run over the existing test corpus.

3. **Cliff handling — good.** `resolve.cliff.test.ts`, cliff-gate disclosure tests, the #90 zero-spacing and cliff-swallows-grid loud-failure cases; #210 landed with 164 test lines. The #213 premise is unchanged. Gap: an *authored* cliff on a pending-head THEN tail is silently discarded with no test noticing (B3).

4. **Re-anchoring / THEN chains — good on dating, weak on accounting.** `resolve.then-chain.test.ts` (725 lines) and compile's chain-matches-unsplit-grid case pin the chain-origin policy on both sides. The gap is chain *accounting*: a tail behind a pending head contributes nothing anywhere and no test asks (B2).

5. **Event-anchor offsets — good.** #180 landed with +118 lines; offset cliffs' effectiveAt covered.

6. **Interchange vs resolution split — broad cases, thin property.** `interchange.test.ts` (485 lines) covers divergence cases and reason precedence, but the defining firing-invariance property is pinned on only two handpicked shapes (**T2**), and no verdict-pair consistency property exists. The property is structural today (one blanked context — see Architecture), so this is insurance against a future threading change, not a present bug.

7. **Parse↔stringify closure — better than it looks.** Orientation's "render: 0 tests" was an undercount — `render/tests/stringify.spec.ts` (496 lines) pins sugar compression, idempotence, semantic re-parse equality, and boundary validation; #211 landed with normalizer + render + prettier tests. The claimed persistence-fixpoint gap was refuted in verification (the commutation test exists). Residual: no corpus-wide round-trip *property*; inferrer-emitted-DSL closure failures are known (#73).

8. **Persist/rehydrate — happy path only.** Witness computation, unfired narrowing, dropped-sidecar degradation, and id round-trip are covered; none of the five bug seams (B5, B6, B9, B15, B16) had a test, and the bare named-EVENT case — the one canonical's EVENT vesting_base exists for — has no coverage on either side of the firing.

**Fix-wave regression-test audit:** every spot-checked fix landed *with* tests — #174, #175, #176, #180, #205, #210, #211, d2fce1f. The wave's hygiene on this axis is genuinely good; the holes are the arms no fix happened to touch.

**The one untested executable surface:** `apps/cli` (445 lines, zero tests — T3), which also hand-renders results rather than sharing presentation (B18 is the symptom).

---

# Probed and found clean

Recorded so the next round doesn't re-plow it. All verified empirically (MCP edge batteries) *and* against source:

- **Month grids don't drift**: `gridDate` computes `i*period` from the anchor absolutely — Jan-31 monthly gives Feb 28 / Mar 31 / Apr 30 / May 31, no Feb-28 stickiness. Leap days, negative steps, year-range guards all pinned.
- **The chain-origin day-of-month policy (#206)** is consistent across `resolveStatements`, `buildTemplate`, and core compile; a DAYS head handing off mid-month springs the MONTHS tail back to the origin day, both sides agreeing.
- **#205 (date_diff vs add_period) is complete**, including the asymmetric reverse direction — modulo the vacuous-clamp *comment* (V11).
- **Cliff lowering round-trips**: fired-vs-deferred parity verified empirically; the deferred cliff's `floor(off/period)` count provably equals the anchored date-count; the kernel's cliff-mismatch loud-throw is correct and unreachable from the DSL.
- **The allocation kernel conserves exactly** at grant 9007199254740991 with thirds, at one- and seven-share grants with off-grid cliffs, and across pre-grant folding; no sibling of the #175 fold-reset bug exists (all three emission paths spend the aggregate).
- **Off-grid fired event cliffs** size the proportional lump correctly (no swallow, no double-count); event starts fired before grant date fold onto grantDate as designed; #180/#181/#174 hold under probing.
- **parse → stringify → parse closed** on a ~55-input battery (selectors both orders post-#211, nested selectors, offsets, gates, cliffs, THEN/PLUS, amounts, schedule-level selectors); #214's spacing canonicalization holds. evaluate → infer_schedule → evaluate reproduced exactly (residual 0) on everything except the by-construction-unreproducible pre-grant-date tranche, which is honestly disclosed.
- **The recover promotion** (rescue republishing under a template verdict) could not be broken: it is licensed by a zero-residual exactness check plus a firing-invariance gate.
- **The two-verdict split for gated starts** behaves exactly per CLAUDE.md §4 (storable template vs resolution-impossible after a violating firing), and the interchange verdict was asOf-stable in the expired-window probe.
- **MCP staleness**: no contradiction between the running server and the working tree was observed in any stream; every reported behavior is implied by current source.

**Open-issue premises** (#213, #102, #91, #73) were checked by multiple streams: none have changed; nothing above re-reports them. The one interaction worth noting is V1 × #102 (if #102 adopts `through = asOf`, the asOf-removal remedy inverts).
