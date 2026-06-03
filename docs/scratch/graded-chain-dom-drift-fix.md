# Graded Chain Day-of-Month Drift — Preserve the Origin Day

**Status:** Phased — ready for implementation
**Issue:** #34 · **Related:** #23 (THEN/PLUS), #35 (cliff-past-segment linter)

A chained DATE schedule should vest on the same days as the identical schedule
written as one un-split grid. Today it doesn't: when a tranche boundary lands on a
short month, the handoff date is clamped, the next segment re-derives its
day-of-month from that clamped date, and the rest of the chain is stuck on the wrong
day. This spec fixes that by carrying the chain **origin's** day-of-month through the
whole chain, so `VESTING_START_DAY` means the vesting *start*'s day applied
consistently — not the day of whatever intermediate date the cursor happens to hold.

## Problem

Under the default `VESTING_START_DAY_OR_LAST_DAY_OF_MONTH` policy, a graded schedule
diverges from its un-split equivalent the moment a segment boundary lands on a month
shorter than the anchor's day. Anchor `2025-01-31`, monthly:

| | one continuous grid | chained, handoff on Feb |
| --- | --- | --- |
| Feb 2025 | 2025-02-28 | 2025-02-28 |
| Mar 2025 | 2025-03-**31** | 2025-03-**28** |
| Apr 2025 | 2025-04-30 | 2025-04-**28** |

(Reproduced against the live engine: `1000 VEST FROM DATE 2025-01-31 OVER 1 month
EVERY 1 month THEN 2000 VEST OVER 2 months EVERY 1 month` vs `VEST FROM DATE
2025-01-31 OVER 3 months EVERY 1 month` — both 1000/tranche on a 3000 grant. This is
the same `2025-01-31`, 1+2 monthly split the `janEnd` characterization test pins, so the
table and the test describe one scenario.)

Same intent — "monthly from Jan 31" — permanently different days after the boundary.
The continuous grid is computed single-shot from Jan 31, so its anchor day stays 31
and March springs back to the 31st. The chained schedule re-anchors at the clamped
handoff `2025-02-28`, whose day is 28, and is stuck on the 28th from then on.

This is **pre-existing core behavior**, not a `THEN` artifact — it affects every
chained DATE statement, including the hand-rolled-offset chains that predate `THEN`.
`THEN` makes chained templates trivial to author, so it surfaces the drift far more
often, but the bug lives in core's compile and would be there with or without the
sequencing operator.

### When it bites, and when it doesn't

Only under `VESTING_START_DAY_OR_LAST_DAY_OF_MONTH`, and only when a boundary lands
on a short month with an origin day of 29, 30, or 31. Yearly tranches (12/24/36-month
hops) don't drift, because the day is preserved across a 12-month step regardless of
origin. `31_OR_LAST_DAY_OF_MONTH` sidesteps it entirely — it targets `min(31,
lastDay)` against any anchor, so it always springs back. That last fact is the seed
of the fix.

## Mechanism

`addMonthsRule` (`core/dates.ts`) picks the target day in its `VESTING_START` branch
as `Math.min(d.getUTCDate(), lastDay)`, where `d` is **the date it is stepping
from**. That anchor-sensitivity is the whole bug:

- **Within one statement there is no drift.** `expandAnchored` builds grid date `i`
  as `addPeriod(anchor, i × period, …)` — always stepping `i` periods from the
  statement's *fixed* anchor. So the day is re-derived from the same origin every
  time, and a Jan-31 statement yields Feb 28, Mar 31, Apr 30… correctly.
- **Across statements it drifts.** `expandStatement` sets statement N+1's anchor to
  `advanceCursor(anchorN, occ × period, …)` — statement N's *clamped* end — and N+1's
  grid steps from that. Once a handoff clamps (Jan 31 + 1mo → Feb 28), the anchor day
  becomes 28 and stays 28 for the rest of the chain.

So the drift is entirely a property of the **cross-statement handoff**: the cursor is
a single date, and once it has clamped, the origin's day-of-month is gone. A Feb-28
cursor produced by clamping Jan 31 is indistinguishable from a genuine Feb-28 origin.

The evaluator mirrors this. Its resolve-time cursor pre-pass (`resolveStatements` in
`evaluator/resolve/lower.ts`) computes each tail's start with the same `advanceCursor`,
so a chain that falls out to `events-only` materializes its tails (`classify.ts`,
`expandResolution`) from the same clamped handoffs and drifts identically. That
mirroring is deliberate — the `template` and `events-only` arms must produce the same
dates — so the fix has to land in both, by the same rule.

## The semantics decision

Two candidate readings of day-of-month for graded/chained vesting:

1. **Re-anchor at the handoff (current).** Each segment vests on its own start's
   day-of-month, so a clamp propagates forward.
2. **Preserve the chain origin's day-of-month** across all segments, so a graded
   schedule matches its un-split equivalent.

**This spec commits to option 2.** The reading is that
`VESTING_START_DAY_OR_LAST_DAY_OF_MONTH` already *names* its intent — the vesting
**start**'s day, or the last day of shorter months — and the bug is simply that core
applies it to each intermediate clamped anchor instead of to the start. Option 2 is
the literal implementation of the policy's own name; option 1 is an accident of the
single-date cursor.

Core is a port of OCF-Tools' compile orchestration, so the reference answer is
whatever OCF/Carta intends. We treat **Carta confirmation as a pre-merge
checkpoint**, not a blocker: we design and build option 2 now on the assumption the
drift is unintended, and confirm before merge. If Carta surprises us and wants option
1, the change is localized enough to drop; the characterization test (below) pins the
current behavior so the diff stays legible either way.

## Approach: thread the chain origin through the steppers

The fix is **not** containable inside `advanceCursor`/`addPeriod` as they stand. By the
time the cursor holds Feb 28, the origin day (31) is already destroyed; a pure date
stepper that only sees the date it's stepping *from* can't recover it. (This refutes
the hopeful note in the THEN/PLUS spec that "a #34 fix propagates to both via the
shared helper" — the helper shares the *arithmetic*, not origin-awareness.) The date
helpers stay pure primitives — they gain no state — but they gain one optional input:
**the chain origin, threaded by callers and defaulting to the date being stepped
from.**

`addMonthsRule` is the only function whose body changes, and only in its
`VESTING_START` branch. It picks the target day from the origin, not from the date it
happens to be stepping from:

```ts
export function addMonthsRule(iso, months, dayOfMonth = DEFAULT, origin = iso) {
  ...
  case "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH":
    return Math.min(toDate(origin).getUTCDate(), lastDay); // was toDate(iso).getUTCDate()
```

`addPeriod` and `advanceCursor` gain the same optional trailing `origin: OCTDate` and
forward it untouched. The clamping logic is already correct; we just point it at the
right day. No mapping table, no policy translation, no `VestingDayOfMonth` string
gymnastics — the union can't express "day 31" directly (that's why its month-end
variants are spelled `_OR_LAST`), and threading the origin sidesteps the union
entirely with plain `min(originDay, lastDay)` arithmetic.

The default is the load-bearing part: `origin = iso` makes any step that passes no
origin compute `min(iso-day, lastDay)` — *exactly* today's behavior. Only the
cross-statement handoff and the post-handoff grid pass a non-default origin (the chain
origin), so only those dates move.

### Why this is safe

Safety is structural, not a case analysis: **the default reproduces today's behavior
at every call site, and only the chain sites override it.** Because `origin` defaults
to `iso` (the date being stepped from), any caller that passes no origin computes the
exact `min(iso-day, lastDay)` it computes today. Verified against every caller — the
offset math in `vestingBase.ts`, the three inferrer steppers (`cadence`, `cliffFold`,
`atoms`), and `unresolved.ts` all step from a fixed point and pass nothing, so they are
byte-identical with no code change. The only callers that pass a non-default origin are
the chain grid and handoff in core's `compile` and the evaluator's `resolve/*`.

This subsumes what the policy-resolution approach had to argue as four separate
invariants — non-chained statements, EVENT-anchored statements, day-≤28 origins, and
non-`VESTING_START` policies all collapse to "no origin passed → default → unchanged."
There is nothing to prove about `31_OR_LAST` matching `VESTING_START`-on-a-31, because
it's the same code path with the same origin, not a translated equivalent.

A day-≤28 origin is automatic for the same reason: `min(28, lastDay) = 28` in every
month, so a day-28 chain never springs anywhere — exactly as a continuous grid from a
day-28 anchor wouldn't. A leap-year Feb-29 origin needs no special case either:
`addPeriod(d, n, YEARS)` is `addMonthsRule(d, n × 12)`, so `min(29, lastDay)` covers it
through the same arithmetic. And DAYS-period chains never reach this branch at all —
`addPeriod` routes `DAYS` to `addDays`, which ignores both policy and origin — so
daily/weekly chains were never affected.

## Blast radius

The chain origin is a single date, fixed **once per chain**. In core there is exactly
one DATE chain per template (all DATE statements chain from `runtime.startDate`), so the
origin is `runtime.startDate`, used globally. (`buildTemplate` sets `startDate` to the
head DATE statement's resolved start; its `eq(start, cursor)` guard forces a single
origin per template — a second DATE start that doesn't equal the running cursor bails to
`events-only`, so a template can't carry two origins.) In the evaluator there can be
many chains (PLUS components, each its own chain), so the origin is the head of each
chain and is threaded per chain.

| Site | Change |
| --- | --- |
| `core/dates.ts` | `addMonthsRule` gains optional `origin = iso` and reads the target day from `origin` in its `VESTING_START` branch. `addPeriod` / `advanceCursor` gain the same optional trailing `origin: OCTDate` and forward it. No new helper, no mapping. |
| `core/compile.ts` | `expandStatement`'s **DATE** branch passes `runtime.startDate` as the origin into `expandAnchored`'s **grid** and the `advanceCursor` handoff. The cliff date stays a durational offset from the segment anchor (origin-blind). The **EVENT** branch passes nothing (doesn't chain → default origin is its firing anchor). The template arm gets all its dates from core's `compile`, so this is the entire template-arm fix. |
| `evaluator/resolve/lower.ts` | Carry the chain origin on `ChainAnchor` and stamp it onto each **tail** `StmtResolution` (new `origin` field); non-tail resolutions carry their own start as origin (the default), so the chain head and independent grids stay byte-unchanged. The three `advanceCursor` sites — `anchorAfter` (head → first handoff), the tail handoff in `resolveStatements`, and the chain-detection cursor in `buildTemplate` — **must all pass the same origin together** (see below). |
| `evaluator/resolve/classify.ts` | The `events-only` arm materializes grids itself. Thread `origin` into the **grids** of `expandResolution` and `loadedResolvedInstallments`, and into `expandResolution`'s pre-cliff count. The cliff **date** in `expandResolution` / `cliffDateOf` stays origin-blind. Default to `r.origin ?? r.start.date` so independent (non-tail) grids anchor on their own start. |
| `evaluator/resolve/cliff.ts` | The cliff **date** stays durational and origin-blind: `measureDuration` keeps probing from the segment anchor, unchanged. Only `lowerCliff`'s pre-cliff occurrence **count** takes the origin, so it rides the same sprung grid core re-partitions on — otherwise its baked `percentage` disagrees with that partition and the boundary tranche misallocates. Date math origin-blind, occurrence counting origin-aware. |

**EVENT-origin THEN chains** (which route to `events-only`) take their origin from the
**firing date**, not from `startDate`. The pre-pass already holds the firing date as
the chain's origin in `anchorAfter`, so it's the same threading with a different origin
value.

**Cliffs ride along but stay durational.** A cliff's date is a duration from its own
segment's anchor and never springs — the clamped `min(anchorDay, lastDay)` from the
handoff is the correct cliff date, landing between grid points if it falls there. Core
already commits to durational (not positional) cliffs, so this is no new semantic. The
one origin-sensitivity is the pre-cliff occurrence *count*: it must be taken on the
sprung grid — the same grid the lump later partitions — or the lowered `percentage`
and the replayed partition disagree and the boundary tranche misallocates. It only
bites the intersection of {sub-annual cliff} × {on a tail} × {month-end chain}; a
12-month cliff preserves the day and the count never diverges. Counting is
origin-aware; cliff-date math is not.

**No change:** `evaluator/resolve/unresolved.ts` (drift-free — it steps from a fixed
start and throws on chained tails; passes no origin) and `lowerDeferredCliff`
(anchor-free offset math).

### The chain-detection consistency risk

`buildTemplate` decides whether a second DATE statement *continues* the chain with
`eq(start, cursor)`, where `cursor` is recomputed by `advanceCursor`. The pre-pass
computes the tail starts the same way. If the pre-pass passes the chain origin but the
detection cursor doesn't (or vice versa), a month-end handoff produces Mar 31 on one
side and Mar 28 on the other, the `eq` check fails, and a valid chain mis-routes to
`events-only` via `OVERLAPPING_ABSOLUTE_STARTS`. So the three `advanceCursor` calls in
`lower.ts` are a single atomic change — they all thread the origin or none do.

## Implementation Phases

### Phase Dependencies

```
Phase 1 (core)
   |
   v
Phase 2 (evaluator cursor)
   |
   v
Phase 3 (evaluator materialization)
   |
   v
Phase 4 (capstone: split-invariance)
```

The chain is strictly linear: each phase consumes the `origin` plumbing the prior phase
introduced. Phase 2 needs the optional `origin` parameter on the steppers (Phase 1).
Phase 3 needs `origin` on `StmtResolution` / `ChainAnchor` (Phase 2). Phase 4's invariant
can only hold once both the template arm (Phase 1) and the events-only arm (Phase 3)
spring back.

### Phase 1: Core steppers + template arm

**Goal:** Thread the chain origin through core so a template-arm month-end chain matches
its un-split equivalent.

**Why First:** The steppers (`addMonthsRule` / `addPeriod` / `advanceCursor`) are the
shared primitive every other phase calls. Their optional `origin` parameter has to exist
before any evaluator caller can pass it.

**Outputs:**
- `addMonthsRule` gains optional `origin = iso`; its `VESTING_START` branch reads the
  target day from `origin` (`min(originDay, lastDay)`).
- `addPeriod` / `advanceCursor` gain an optional trailing `origin: OCTDate`, forwarded
  untouched.
- `expandStatement`'s DATE branch passes `runtime.startDate` into `expandAnchored`'s grid
  and the `advanceCursor` handoff; the cliff date stays a durational offset (origin-blind);
  the EVENT branch passes nothing (default origin is its firing anchor).

**Definition of Done:**
- [ ] A month-end chain compiled by core matches the un-split grid (Jan 31 → Feb 28,
  Mar 31, Apr 30).
- [ ] day-≤28, EVENT-anchored, and non-`VESTING_START` cases are byte-unchanged (no origin
  passed).
- [ ] Full CI suite green from root (build / typecheck / lint / knip / format:check / test).

---

### Phase 2: Evaluator cursor + chain detection

**Goal:** Carry the chain origin through the evaluator's resolve-time cursor pre-pass
without breaking chain detection.

**Inputs:**
- Optional `origin` on the core steppers (Phase 1).

**Outputs:**
- `origin` field on `StmtResolution` and `ChainAnchor`, set to the chain head
  (`startDate` for DATE chains, the firing date for EVENT-origin chains); non-tail
  resolutions carry their own start as origin, so the chain head and independent grids
  stay byte-unchanged.
- The three `advanceCursor` sites in `lower.ts` — `anchorAfter` (head → first handoff),
  the tail handoff in `resolveStatements`, and the chain-detection cursor in
  `buildTemplate` — thread the same origin **together** as one atomic change, or
  detection mis-routes a valid chain to `events-only`.

**Definition of Done:**
- [ ] The pre-pass-dates-equal-core-dates tripwire still holds.
- [ ] A month-end chain still classifies to `template` (detection didn't break).
- [ ] Full CI suite green from root.

---

### Phase 3: Evaluator materialization + characterization flip

**Goal:** Spring the dates back on the `events-only` arm and align the pre-cliff count
with the sprung grid.

**Inputs:**
- `origin` on `StmtResolution` / `ChainAnchor` (Phase 2).

**Outputs:**
- `origin` threaded into the grids of `expandResolution` and `loadedResolvedInstallments`
  (`classify.ts`) and into `expandResolution`'s pre-cliff count, defaulting to
  `r.origin ?? r.start.date` so independent grids anchor on their own start.
- `origin` threaded into `lowerCliff`'s pre-cliff occurrence **count** (`cliff.ts`); the
  cliff *date* math — the selector, `measureDuration`, the cliff-date `addPeriod`,
  `cliffDateOf` — stays origin-blind, so a durational cliff lands wherever its duration
  puts it (between grid points if need be).
- The `janEnd` characterization case flipped from the drifted dates (`…02-28, …03-28,
  …04-28`) to the sprung-back dates (`…02-28, …03-31, …04-30`), labeled as the fix landing.

**Definition of Done:**
- [ ] An `events-only` month-end chain materializes the un-split dates.
- [ ] A *sub-annual* tail cliff on a month-end chain keeps its lump percentage and
  post-cliff tranche amounts consistent with the sprung grid.
- [ ] `janEnd` expectation flipped; the rest of the chain suite stays on drift-free anchors
  and is unchanged.
- [ ] Full CI suite green from root.

---

### Phase 4: Capstone — parametric split-invariance

**Goal:** Lock the split-invariant with a parametric guard whose oracle is independent of
the change.

**Inputs:**
- A fully sprung template arm (Phase 1) and events-only arm (Phase 3).

**Outputs:**
- Generalize the existing drift-free tripwire (`resolve.then-chain.test.ts`, the
  first-of-month 12+12 chain) to a table over origin days × period types:
  `{2025-01-31, 2025-01-30, 2025-01-29, 2024-02-29 (leap)}` × `{MONTHS, YEARS}`, each
  splitting a chain mid-grid on a boundary that lands in a short month.
- Each cell built uniformly graded (head amount/occ == tail amount/occ, so a
  single-statement equivalent exists at all) with totals that are clean multiples of the
  occurrence count — core drops zero-amount events, so a tranche that rounds to zero on
  one path but not the other would break even the *date* equality. Origin + period in the
  case name so a failure points to the exact cell.

**Definition of Done:**
- [ ] For each cell, the split chain and its single-statement un-split equivalent produce
  **identical dates and identical amounts**.
- [ ] The oracle is the un-split **compile**, never a hand-built `addPeriod` array
  (asserting against `addPeriod(origin, i, …)` would test the modified helper against
  itself). The example-based assertions in Phases 1–3 stay for legibility — they name
  *which* dates, which is what a human wants when a test goes red.
- [ ] Full CI suite green from root.

---

## Phase Checklist

### Phase 1: Core steppers + template arm
- [ ] `packages/core/src/dates.ts` — `addMonthsRule` (`VESTING_START` branch), `addPeriod`, `advanceCursor`
- [ ] `packages/core/src/compile.ts` — `expandStatement` DATE branch, `expandAnchored`
- [ ] core tests — month-end chain vs un-split grid; day-≤28 / EVENT / non-`VESTING_START` unchanged

### Phase 2: Evaluator cursor + chain detection
- [ ] `packages/evaluator/src/resolve/lower.ts` — `origin` on `StmtResolution` / `ChainAnchor`; `anchorAfter`, `resolveStatements` handoff, `buildTemplate` detection cursor (atomic)
- [ ] evaluator tests — pre-pass == core-dates tripwire; month-end chain classifies `template`

### Phase 3: Evaluator materialization + characterization flip
- [ ] `packages/evaluator/src/resolve/classify.ts` — `expandResolution`, `loadedResolvedInstallments` grids + pre-cliff count
- [ ] `packages/evaluator/src/resolve/cliff.ts` — `lowerCliff` pre-cliff count (cliff-date math origin-blind)
- [ ] `packages/evaluator/tests/resolve.then-chain.test.ts` — flip `janEnd`

### Phase 4: Capstone — parametric split-invariance
- [ ] `packages/evaluator/tests/resolve.then-chain.test.ts` — parametric origin × period table

## Open question / checkpoint

Confirm Carta/OCF's intended day-of-month semantics for graded/chained vesting when a
tranche boundary lands on a short month: re-anchor at the clamped handoff (option 1),
or preserve the chain origin's day-of-month (option 2). We build option 2; this is the
one thing to confirm before merge, since core mirrors OCF/Carta and we'd rather not
diverge from the reference on a silent date-math difference. If the checkpoint goes
against us, the revert is mechanical: option 1 *is* the default (`origin = iso`), so
dropping the change means deleting the origin arguments at the chain sites. The
characterization test below pins the current behavior so that diff stays legible.
