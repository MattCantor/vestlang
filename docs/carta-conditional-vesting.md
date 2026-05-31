# Conditional Vesting as an OCF Extension

How vestlang's three fidelity verdicts are really statements about *which canonical layer can hold
a schedule*; how a contingent (combinator-gated) schedule can still round-trip as a canonical
`template` by externalizing its gate to a **synthetic event** plus a **source map**; and why the
home for that source map is a **governed, namespaced `ext` channel** on canonical — making vestlang
the first worked example of an OCF-core extension mechanism.

## Status

- **Status**: Design Specification (concept-level) — supersedes the earlier Carta-centric draft and
  substantially expands the in-review fidelity draft. **Also a proposal *to* canonical / OCF** (the
  `ext` channel; restoring `comments`). A review pass revised three things below: the synthetic
  `event_id` scheme (**content hash → opaque grant-scoped surrogate**), the verdict model
  (**IMPOSSIBLE is a terminal runtime arm, not a static check; `fidelity` sub-classifies only the
  *resolvable* outcomes**), and the reach of Case 2 (**start anchors only** — event cliffs select a
  structure, so they stay `unresolved` until fired).
- **Priority**: High (carries the OCTC summit narrative).
- **Complexity**: High.
- **Interchange target**: OCF **canonical** (`~/code/OCF-Composed-Schemas/canonical/`) — the
  proposed "OCF-core" vesting model that itself maps down to Carta Cap Table Data Schema
  **v1alpha1**. Canonical is the target; **Carta is downstream**.
- **Relates to**: `docs/core-extended-split.md` (the fidelity ladder this revises in two places),
  `docs/simple-vesting-spec.md`, `docs/carta-vesting-question-email.md` (the one open Carta
  export-mapping question).

---

## Overview

This doc carries three threads, in dependency order:

1. **Fidelity is a property of the spec, not the projection (Case 1).** An EVENT-anchored statement
   is a valid `template` whether or not its event has fired. "Pending" is not a field — it is the
   absence of a firing witness. The simple unfired event was *miscategorized* as `unresolved`; it is
   a `template`.
2. **Contingent schedules can be templates too (Case 2).** A combinator *over anchors* with a fixed
   downstream grid (e.g. `LATER OF(+12mo, EVENT "ipo")` as a start) selects an **anchor**, not a
   **structure** — so it can lower to one canonical `template` by externalizing the gate as a
   **synthetic event**. The combinator's meaning travels in a **source map** (`event_id → DSL`)
   beside the template, and **rehydration = re-resolution → witness**.
3. **The source map needs a governed home → the OCF `ext` channel.** Canonical can't hold the
   combinator's meaning today (it's `additionalProperties: false`, and `VestingBaseEvent`
   deliberately keeps the event's meaning out-of-band). The fix is a namespaced, ignorable extension
   channel on canonical. This makes vestlang the **charter example** of the OCF-core + opt-in
   extensions architecture — the meta-theme of the OCTC summit, where Carta's read model is being
   renormalized into an "OCF core" that members extend selectively.

The arc: **hold the spec if you can (Cases 1 & 2); fall back to the dated projection; report
inexpressible only when both fail** — and carry the contingency that core can't hold in an
extension that core consumers safely ignore.

---

## Part I — Fidelity is a property of the spec (Case 1)

### The layer the verdict belongs to

Canonical (per its README) is **spec + runtime + projection**:

- **Spec** — `VestingScheduleTemplate` / `VestingStatement`; `vesting_base: DATE | EVENT { event_id }`. The rule, grant-independent.
- **Runtime** — `TX_CANONICAL_VESTING_START` (the date anchor) and `TX_CANONICAL_VESTING_EVENT` (a firing *witness*).
- **Projection** — OCF `Vesting { date, amount }`. The compiled output.

Fidelity asks "can the interchange hold this schedule's *shape*?" — a question about the **spec**.
vestlang currently answers it from the **projection**: it tries to compute installments, and when an
event hasn't fired it returns symbolic/blocked ones and tags the whole schedule `unresolved`. But an
incomplete projection doesn't mean an inexpressible spec. Trace an unfired event through the three
layers:

- **Spec:** the EVENT statement is present and valid. The template needs no runtime to *be* valid.
- **Runtime:** no witness has arrived.
- **Projection:** nothing is emitted for that tranche — `{date, amount}` requires a date it lacks.

So "this portion vests on event X, which hasn't fired" is fully expressed by *(EVENT statement) +
(no witness)*. There is **no "pending" field anywhere, by design — pending is the absence of a
fact.** Classifying on the projection conflates **"not realized yet"** with **"not representable."**

(This is the same read-model-vs-spec confusion seen on the Carta side: Carta's condition object fuses
the *rule* with its *evaluation status* because it's an API read model. vestlang must not import that
fusion.)

### Resolution outcomes and the fidelity ladder

Resolving a spec against runtime yields one of three outcomes — **resolvable**, **pending**, or
**impossible**. *Fidelity* sub-classifies only the **resolvable** ones: it asks which canonical layer
can hold a schedule that *has* a satisfiable shape. Pending and impossible are not fidelity levels —
they are statements about **resolvability**, also computed against runtime (impossibility is *not* a
static pre-check; see "Resolvability vs fidelity" below).

| resolution outcome | verdict | Canonical representation | What lives here |
|---|---|---|---|
| **resolvable** | **`template`** | the grant references a `VestingScheduleTemplate` (the spec) | time-based schedules **and** atomic event-anchored ones (EVENT statements). The projection fills in as `TX_CANONICAL_VESTING_EVENT`s arrive. **Plus contingent schedules via Case 2.** |
| **resolvable** | **`events-only`** | the materialized `vestings` array (OCF `Vesting {date, amount}`) | resolved and dated but doesn't fit one template: overlapping absolute starts, a loaded allocation mode |
| **pending** | **`unresolved`** | neither *yet* | a combinator-over-*structures* awaiting its selector; an event cliff awaiting its firing — **satisfiable, not yet determined** |
| **impossible** | **`impossible`** | none | a self-contradiction — **unsatisfiable**; no witness assignment can ever resolve it. A **terminal** verdict, not a fidelity level |

Read the first two rows as a ladder: hold the **spec** if you can; fall back to the **dated
projection**. The atomic unfired event sits at the **top** — it has a spec — even though its
projection is empty so far. `unresolved` and `impossible` sit *off* the ladder: the first is "not
yet," the second is "never."

### Verified: where this bites in the current code

Both claims the earlier draft flagged "needs verification" are now **confirmed against the worktree**:

- `resolve/lower.ts:182` — `buildTemplate` returns the `unresolved` arm the moment **any** statement's
  start isn't `RESOLVED` (`resolutions.some((r) => r.start.state !== "RESOLVED")`). An unfired EVENT
  start fails `isPickedResolved` and lands in the `UNRESOLVED` branch (`lower.ts:117–130`), so an
  atomic unfired event forces `unresolved` — even though core's template model doesn't need the
  firing.
- `core/compile.ts:166` returns `null` for an EVENT statement with no matching firing, and `:201`
  skips past it. So a template containing an unfired EVENT statement **compiles fine** — it just emits
  nothing for that statement. The reclassification is mechanically sound: lower an EVENT-anchored
  statement into the template with its `event_id` and **no resolved date**, leaving the firing to
  runtime.

### The HYBRID bug this exposes (facts lost, not just intent)

The atomic empty-projection case is the *mild* version. The damaging one is a **HYBRID**: a
DATE-anchored portion vesting *now* **plus** an unfired EVENT portion — e.g.
`PORTION 75% MONTHLY OVER 48` (DATE) and `PORTION 25% ON EVENT "ipo"` (EVENT). Today `lower.ts:182`'s
`some()` check means the unfired EVENT poisons the **whole** program to `unresolved`, so the
already-vesting, fully-dated DATE installments are hidden too. That is **realized facts lost behind an
`unresolved` verdict**, not merely intent lost. (Verified empirically against this branch: the
4,800-share hybrid above — `75% MONTHLY OVER 48` from 2025-01-01 + `25% ON EVENT "ipo"`, evaluated
as-of 2035 with `ipo` unfired — returns `fidelity: unresolved` with **0 dated installments**; all
3,600 already-vested time-based shares are dropped, leaving one dateless symbolic installment for the
25%.) Classifying on the spec fixes this: the DATE portion
resolves and dates; the EVENT portion floats pending its witness; the schedule is a `template`.

### Resolvability vs fidelity — three orthogonal axes

Classifying on the spec forces three reads that used to travel together to come apart. Once an
unfired event can sit inside a `template` (Case 1, and Case 2 below), a schedule can be
`fidelity: template` **and** carry blockers **and** project nothing — all at once. So three fields
answer three different questions:

| field | answers | property of |
|---|---|---|
| `fidelity` | which canonical layer holds the spec (`template` / `events-only`) | the **spec** (representability) |
| `blockers` | why the projection is incomplete — which witnesses are missing | the **runtime** (pending-ness) |
| `installments` | the projection so far | the **projection** (may be empty under a `template`) |

The consumer rule that falls out: **"pending" is read from `blockers`, never from `fidelity`;
"representable" is read from `fidelity`, never from `installments`.** This is the operational form of
"pending is the absence of a fact." A surface that gates on `fidelity === "unresolved"` (today's MCP
`vestlang_evaluate` / CLI) would **miss** Case 1/2 pending-templates and render them as complete — so
those surfaces must move to keying pending off `blockers`.

Impossibility lives on the *resolvability* axis, not the fidelity one — and it is **runtime-derived**,
not static. The same spec (`AFTER EVENT "ipo" AND BEFORE 2025-01-01`) is `unresolved` while the IPO is
unfired, `impossible` once it fires after 2025, and `template` if it fires before. So `impossible` is
the **terminal/unsatisfiable** outcome (no future witness helps), distinct from `unresolved`'s
**transient/pending** (a witness might yet resolve it). Detecting impossibility from a *non-firing*
("the IPO still hasn't fired, so `BEFORE 2025` can never be met") rides the same **closed-world**
assumption as the resolver's date-capped selectors — see Stage D — so the `unresolved → impossible`
transition is monotonic only under append-only, forward-dated firings.

### The atomic-vs-combinator boundary

The boundary for Case 1 is **atomic condition vs. combinator**, and it's already enforced structurally
in the resolver (`startBase`/`firstSchedule` only treat a bare `SINGLETON` EVENT as base-EVENT). The
genuinely non-template cases:

| construct | why | lands as |
|---|---|---|
| **Atomic event** — `EVENT "ipo"` | canonical-native EVENT statement | **`template`** (Case 1) |
| **Combinator over anchors** — `LATER OF(+12mo, EVENT "ipo")` | canonical has no combinator… | **`template`** *if it selects an anchor* (Case 2, Part II); else `unresolved` |
| **Event-anchored cliff** — `CLIFF EVENT "ipo"` | the firing *partitions* the grid (lump size + pre/post split) → selects a **structure**, not an anchor; and canonical/Carta cliffs are duration-only | **pending → `unresolved`; resolved → concrete statements / `events-only`.** **Not** a synthetic-event/Case-2 case (Part II close). The engine routes all event cliffs to events-only today (`lower.ts:189`). |

> This revises `core-extended-split.md:131` ("Unfired EVENT → … `unresolved` + blockers") — an
> unfired atomic EVENT is now a `template`. (These design docs are working scratch; the sibling is not
> edited — the revision is named here so we don't trip over it mid-build.)

---

## Part II — Contingent schedules can be templates too (Case 2)

### The insight: a combinator over anchors selects an *anchor*, not a *structure*

`core-extended-split.md:76` argues combinators can't be templates because
`LATER OF(12mo, EVENT "ipo")` "resolves to a *different template* depending on which wins." That is
**overstated for a start anchor**: the occurrences/period/percentage downstream are identical
regardless of which arm wins — only the *anchor date* moves. A fixed structure with a single deferred
anchor is exactly what a named event models. So the ladder is finer than the sibling draws:

- **Combinator that collapses to one anchor** (a date or a condition) with a fixed downstream grid →
  **`template`**, by externalizing the anchor as a **synthetic event** + a source-map definition.
- **Combinator that genuinely selects among different structures** (different occurrences /
  percentages) → stays `unresolved` / `events-only`.

> This revises `core-extended-split.md:76`: combinator-*over-anchors* ≠ combinator-*over-structures*.
> Only the latter is template-inexpressible.

### The synthetic event is canonical-native

To hold `LATER OF(+12mo, EVENT "ipo")` as a template, the combinator's anchor collapses to a single
atomic event `evt_…`. Then:

- **Spec:** an ordinary `VestingStatement` with `vesting_base:{type:"EVENT", event_id:"evt_…"}`. The
  downstream grid is unchanged.
- **Runtime:** an ordinary `TX_CANONICAL_VESTING_EVENT` witness, once known.

So **the template and the witness need no schema change.** But the synthetic event is *not*
"indistinguishable from a real named event" — it is identical in **shape** (an ordinary EVENT
statement + a witness) and distinct in **scope.** There are now two tiers of event:

| | **named event** (`EVENT "ipo"`) | **synthetic event** (`evt_…`) |
|---|---|---|
| witness origin | a real-world fact, attested once | **computed** by re-resolving the definition |
| scope of the witness | **global** — one date, shared by every grant referencing `"ipo"` | **grant-local** — `resolve(definition, thisGrant.runtime)` |
| depends on | nothing but itself | the grant's date context (grant date, resolved vesting start) **+** the named events its definition references |

A named `"ipo"` is a fact about the *world*; `LATER OF(+12mo, EVENT "ipo")` is a fact about *this
grant* (its `+12mo`) combined with a fact about the world. Two grants with the byte-identical anchor
resolve to **different** witness dates, so a synthetic event's firing is grant-local, not a
coalition-wide fact — it cannot be hoisted to a shared event registry the way `"ipo"`'s firing can.
This is why the id is **grant-scoped** (Part III) and the definition is stored **once per grant
template** (Part IV). The only thing canonical can't hold is the event's **definition** (`evt_… =
LATER OF(+12mo, EVENT "ipo")`) — see Parts III–IV.

### Not the synthetic-firing smuggle

`core-extended-split.md:174` rejects encoding an independent **absolute-date grid** as an event with a
synthetic firing — faking *service/calendar time* as a condition. Case 2 is different, but the
distinguishing test must be **structural, not outcome-based.** "Is the anchor a real condition or a
calendar date dressed up as one?" asks about the *resolved outcome* — which is undecidable at emit
(you don't yet know which arm wins) and isn't even discriminating: *both* `LATER_OF` and `EARLIER_OF`
can resolve to a pure calendar date (`LATER OF(+12mo, EVENT "ipo")` with the IPO firing early =
`max(2026-01-01, …)` = 2026-01-01). So the witness landing on a calendar date can't be the signal.

The right test — decidable at emit, and the policy the resolver already implies
(`core-extended-split.md:174`, "emit an EVENT statement only when the DSL names a real event"):

> A combinator anchor earns a synthetic event iff its **definition references at least one genuine
> condition** (a named `EVENT`). The smuggle is a definition with **no condition at all** — a pure
> `FROM DATE` grid dressed as an event.

Under this test both `EARLIER_OF` and `LATER_OF` over `EVENT "ipo"` qualify; the pure-date grid still
fails and routes to `events-only`. And the calendar-outcome can't recreate the case-3 harm (mislabeling
*pure* service time as performance-conditioned): the **opaque id gives a blind reader opacity, not a
perf/service mislabel** — it sees "opaque `evt_…` fired 2026-01-01," never an asserted ASC-718
performance condition — and the source-map definition preserves the full hybrid truth for anyone who
can read it. The case-3 harm requires asserting a condition where *none* exists; a combinator anchor's
definition always contains one.

### Case 2 is start-anchor-only — cliffs are the mirror

The synthetic-event device works for a **start** anchor because a combinator over anchors selects an
*anchor, not a structure*: the downstream grid is invariant regardless of which arm wins, so you can
store a fixed template and defer one date. An event-gated **cliff** is the exact counter-example. On a
start-anchored grid (`monthly OVER 48 FROM 2025-01-01, CLIFF EVENT "ipo"`), the firing date
**partitions** the grid — it sets both the *lump size* (everything accrued by the firing) and the
*pre/post split point*. So the downstream structure is *a function of* the unknown date, not invariant.

That is precisely "selects a structure," which routes *away* from `template`. Hence a cliff has **no
pending-template form**: while the event is unfired it is `unresolved` (the lump can't be deferred into
any canonical field — the time-based cliff is duration-only, with no `event_id` slot and no
compute-the-lump-from-a-firing semantics); once fired, the partition is known and it lowers to concrete
statements (a floating EVENT lump at the firing + a start-anchored suffix) or to `events-only`. The
synthetic event **never applies to a cliff**: its only job is to defer a date inside a *stored pending
template*, and a cliff is never that — it is pending-and-not-a-template, or resolved-and-concrete.
(Combinator cliffs behave identically; the combinator changes nothing, since neither can be a pending
template.) The one thing that would change this is extending canonical's cliff field to reference an
event *and* compute the lump at projection time — a change to **core cliff semantics**, out of scope
here.

---

## Part III — The source map and rehydration

### The source map

Externalizing the gate produces a **source map**: `event_id → { definition, label? }`, where
`definition` is the anchor `VestingNodeExpr` rendered to a DSL string via `@vestlang/stringify` (entry
shape detailed under "The id," below). It rides on extended's output and **absorbs the blockers** — a
blocker stops meaning "I failed to classify" and starts meaning "here is an externalized condition, its
DSL definition, and (currently) why its witness can't be computed yet."

### The output contract is a four-arm union

Storing the canonical artifact is the whole point of Case 2, so the output must carry the **spec** and
**runtime**, not just the projection. `packages/types/src/evaluation.ts` (`EvaluatedSchedule`,
`Fidelity`) is installments-centric today and has no slot for them. The verdict is a **four-arm
discriminated union** — and the presence of the artifact is *implied by* the arm, so encode it in the
type rather than as bolt-on optionals:

```ts
type EvaluatedSchedule =
  | { fidelity: "template";    template: ExtTemplate; runtime: VestingRuntime;
                               sourceMap: SourceMap; installments: ResolvedInstallment[]; blockers: Blocker[] }
  | { fidelity: "events-only"; installments: ResolvedInstallment[]; reason: NonTemplateReason; blockers: Blocker[] }
  | { fidelity: "unresolved";  installments: SymbolicInstallment[]; blockers: Blocker[] }
  | { fidelity: "impossible";  installments: ImpossibleInstallment[]; blockers: ImpossibleBlocker[] }
```

Only the `template` arm carries the `{template, runtime, sourceMap}` artifact. `sourceMap` is its own
**engine-neutral** field — whether it is persisted *in-band* (`template.ext.vestlang`) or as a
*sidecar* table is a downstream serialization choice (Part IV), not part of the output shape. The
`fidelity` tag becomes **required** once the legacy engine is gone (Phase 5b) — its optionality today
exists only because the legacy engine left it undefined. (`impossible` is the terminal verdict of
"Resolvability vs fidelity"; the discriminant now spans both *resolvability* and *fidelity*, so a name
like `status` reads more honestly than `fidelity`.)

### Worked example (4,800 shares, granted 2025-01-01)

DSL: `100% MONTHLY OVER 48 FROM LATER OF(+12 MONTHS, EVENT "ipo")`.

**Stage A — first emit, IPO unfired.** Lowering to a *template* resolves the spec **structurally**
(asOf *off*: dates resolve to their values regardless of the clock — this is Part I's spec/projection
split, not an as-of projection). So `+12mo` resolves to 2026-01-01 and only the IPO is genuinely
pending: `LATER OF(2026-01-01, ipo=?)` can't resolve (the max is undetermined). Instead of bailing to
`unresolved`, extended externalizes the anchor as a **grant-scoped synthetic event** (`evt_…` — an
opaque surrogate; see "The id," below):

```jsonc
{
  "fidelity": "template",
  "template": {                                    // canonical SPEC — pure OCF semantic fields, no ext
    "id": "resolved",
    "statements": [
      { "order": 1, "vesting_base": { "type": "EVENT", "event_id": "evt_g7f3_01" },
        "occurrences": 48, "period": 1, "period_type": "MONTHS",
        "percentage": { "numerator": 1, "denominator": 1 } }
    ]
  },
  "runtime": { "grantDate": "2025-01-01" },        // RUNTIME — no witness for evt_g7f3_01 yet
  "sourceMap": {                                   // engine-neutral; persistence folds this into
    "evt_g7f3_01": {                               //   template.ext.vestlang (proposed) or a sidecar (shipped)
      "definition": "LATER OF(+12 MONTHS, EVENT \"ipo\")",
      "label": "1-year cliff or IPO"
    }
  },
  "installments": [],                              // PROJECTION — empty; EVENT statement skipped
  "blockers": [                                    // pending-ness, advisory under a `template` verdict
    { "type": "UNRESOLVED_SELECTOR", "selector": "LATER_OF",
      "blockers": [ { "type": "EVENT_NOT_YET_OCCURRED", "event": "ipo" } ] }
  ]
}
```

**Stage B — store.** The canonical template + runtime persist as OCF objects (the `evt_g7f3_01` EVENT
statement is an ordinary floating-event statement); the source map persists as a sidecar table keyed
by `event_id` (shipped) or *in* the template's `ext.vestlang` bag (proposed) — Part IV. A
vestlang-blind reader sees a valid template gated on an opaque, not-yet-fired event — correct, just
opaque.

**Stage C — IPO fires 2027-03-01; rehydrate.** Rehydration is **re-resolution of the anchor
expression**, nothing more:

```
resolve( "LATER OF(+12 MONTHS, EVENT \"ipo\")",
         { grantDate: 2025-01-01, events: { ipo: 2027-03-01 } } )
   = LATER_OF( 2026-01-01, 2027-03-01 ) = 2027-03-01      // IPO arm wins
```

That date **is** `evt_g7f3_01`'s witness:

```jsonc
{ "eventFirings": [ { "event_id": "evt_g7f3_01", "date": "2027-03-01" } ] }
```

The **stored template is untouched** — rehydration only *adds a witness*. Canonical's compiler then
runs `compile(template, runtime + witness)` → 48 monthly tranches of 100 from 2027-04-01 to
2031-03-01, telescoping exactly to 4,800.

**Stage D — partial case, and the limits of monotonicity.** Rehydrate at 2026-06-01 (grant+12mo
passed, IPO still unfired): `LATER_OF` still can't resolve (IPO could be later) → no witness produced,
blocker narrows to just `{EVENT_NOT_YET_OCCURRED: "ipo"}`. Rehydration is **monotonic under
append-only, forward-dated firings** — across that window it only ever *adds* witnesses and *narrows*
blockers, so re-run it freely. The one exception is a **back-dated firing** (an IPO recorded late but
dated in the past): that is a data *correction*, and it can *re-resolve* an already-resolved anchor —
not a pure addition.

Whether an anchor can resolve early is a property of the combinator's *shape*, grounded in the resolver
(`packages/evaluator/src/evaluate/selectors.ts`) plus the asOf-gating of date arms
(`vestingNode/vestingBase.ts:19`, `DATE_NOT_YET_OCCURRED`). `LATER_OF` (`LATER_POLICY` = *all* arms
resolved) treats the event as an **open upper bound** — it can only resolve from a *positive* firing,
so it never resolves prematurely and never revises. `EARLIER_OF` (`EARLIER_POLICY` = *some* arm
resolved) is **capped** by its date arm: before the cap it stays pending (the date arm is itself
asOf-unresolved), and once the clock passes the cap with the event unfired it resolves to the cap under
a *retroactive* closed-world read ("no firing through a date we've now observed past"). That read is the
same one `unresolved → impossible` detection relies on (see "Resolvability vs fidelity"), and the same
back-dated-correction caveat applies to both.

The point: a synthetic event's witness is **computed by re-resolving the definition**, not attested by
hand. Without the definition the milestone is un-evaluatable except manually — which is the sharp
reason the source map is load-bearing, not decorative.

### The id — an opaque, grant-scoped surrogate

The synthetic `event_id` is an **opaque, grant-scoped, deterministic surrogate**, minted once at first
emit and thereafter *read, never recomputed*. It is **not** a content hash of the gate, and **not** the
DSL string. Two facts drive this.

**The id is persisted and read, never re-derived.** Trace its life: at emit it is minted and written in
three places (the template statement, the source-map key, the eventual witness); at rehydration we
already hold the stored template + source map, so we **read** the id off the statement, look up its
definition, re-resolve, and attach the witness to that *same stored id*. Nothing ever recomputes the id
from the definition. So "same expression → same id at emit and every rehydration" is satisfied by
**persistence**, not by hashing — determinism-of-hash buys nothing. And because a round-trip can only
*carry an opaque token through* (you cannot recompute it), the surrogate makes lossless passthrough
(Part V) the *only* option — which is exactly why it is **safer on round-trips than a hash**, which
would tempt a re-importer to "recompute it, it'll match" and silently diverge if canonicalization ever
drifts.

**Content-addressing is rejected.** A hash of the canonicalized anchor AST buys exactly one thing a
surrogate lacks — *decentralized reproducibility* (two independent systems minting the byte-identical id
for the same gate without coordinating). That is needed in **no** workflow here: the artifact is
persisted and edited in place (Stages B–C); single-producer/many-consumer and round-trip flows *read*
the stored id; re-derivation-from-source after the artifact exists never happens. Worse, a content hash
is *actively wrong* across grants — the same gate has **different** witnesses on different grants (the
two-tier model above), so collapsing them to one id is incorrect — and it would impose a fragile,
frozen-forever canonicalization contract (commutativity, unit normalization, collision-resistant width)
as a durable dependency. The surrogate dissolves all of that.

**Grant-scoping is by construction.** A surrogate minted per (grant, gate) is grant-local with no salt;
the token simply **carries grant identity** (e.g. `evt_<grantref>_<ordinal>`) so synthetic events don't
alias in a flattened event stream (a `TX_CANONICAL_VESTING_EVENT` is per-security, but a global event
table would otherwise collide bare `evt_01`s across grants). Within one template, two portions gated on
the *same* anchor must still share one id — done by an **emit-time structural-equality check** on the
anchor (the one-firing-per-`event_id` dedup at `lower.ts:213`). That check is far weaker than a durable
canonical hash: it runs only at emit with both expressions in hand, can **evolve freely** (it is never
serialized), and a *miss* merely yields two surrogate events with identical definitions that re-resolve
to the same date — **harmless redundancy, not corruption** (the `OVERLAPPING_ABSOLUTE_STARTS` failure at
`lower.ts:216` needs *one* id firing at *two* dates, impossible with distinct surrogates).

**Why not the DSL string itself** — three reasons, all of which survive and argue *for* a surrogate:

1. **Natural-key instability.** The id would be welded to the exact spelling; reordering args,
   relabeling, or a serializer change would dangle every stored reference/witness. An opaque surrogate
   decouples identity from description entirely — cosmetic *and* semantic edits never move an existing
   id (a changed gate just gets a freshly-minted one).
2. **Contract mismatch / honest opacity.** `event_id` is an **OCF-core** field whose contract is
   "opaque identity token." A DSL string there leaks vestlang grammar into core and *lies* to core-only
   consumers — it dangles an evaluable-looking formula at a consumer with no engine. An opaque
   `evt_g7f3_01` tells that consumer the truth: "you can't resolve this; treat it as pending."
3. **Durable-dependency / grammar leak.** `event_id` lives in a durable, multi-party interchange.
   Embedding the grammar there makes the coalition's stored data carry a permanent dependency on
   vestlang's grammar versions. The surrogate keeps the core field grammar-neutral; the grammar lives
   only in the (opt-in) source-map definition.

Mental model: **id = identity (opaque, core, grammar-neutral); definition = meaning (vestlang grammar,
extension).** *(If decentralized reproducibility ever becomes a hard requirement, that — and only that —
reopens a content hash, which would then owe a fully-specified, versioned, ≥128-bit collision-resistant
canonicalization as its entry price.)*

**The definition entry.** The source map stores `event_id → { definition, label? }`, where `definition`
is the **versioned DSL string** (`@vestlang/stringify` output) — re-resolvable *and* legible, so no
redundant second serialization. Two guarantees ride on it: `parse ∘ stringify` must be a **verified
round-trip fixpoint** (rehydration re-parses the string, so a non-fixpoint would drift the witness — a
property vestlang's stringify should hold regardless), and the entry is **versioned** via the namespace
(`vesting.vestlang.dev/v1`, Part V) so an evolving grammar never strands an old definition. `label` is a
**display name** only (e.g. "1-year cliff or IPO") — never identity, never a second encoding of the
gate; legibility of the *source* already lives in `definition`.

---

## Part IV — Where the definition lives: the `ext` channel

### Placement: template-level, keyed by event_id

The source map lives at the **template level**, keyed `event_id → { definition, label? }` — **not** on
each `VestingBaseEvent`. The template is the **grant-scoped container** (a synthetic event is
grant-local; the two-tier model in Part II), so it is the natural home for grant-local definitions. And
within one template the emit-time dedup yields one id per distinct gate, so the map is keyed once per
`event_id`: two statements sharing a gate share the id *and* the single definition entry. Storing it
per-reference would be a **denormalization** (duplicate, drift-prone) — precisely the read-model
redundancy this project renormalizes away. It also mirrors canonical's own shape: the **firing** is
recorded once per `event_id` (one witness resolves all referencing statements), so the **definition** —
the spec-time twin of the firing — is likewise recorded once per `event_id`. `VestingBaseEvent` stays
byte-for-byte canonical-core.

### What canonical changes

- **No change** to the template/witness **semantic** fields. The synthetic event is native.
- **The source map is engine-neutral in extended's output** (its own `sourceMap` field, Part III).
  Whether it persists *in-band* (`ext.vestlang`) or as a *sidecar* table keyed by `event_id` is a
  serialization choice — not a change to either; the `ext` channel below is the in-band option.
- **Add** a two-tier extension channel (Part V): `ext` (ignorable) and `modifierExt`
  (must-understand-or-refuse), as **known named properties** on canonical objects.
- **Keep `additionalProperties: false`.** Unknown *top-level* fields are still rejected — `ext` is the
  one blessed property, and its keys are owned namespaces, so collisions are structurally impossible.
- **Restore `comments`.** Canonical dropped the OCF base-object `comments` array from
  `TX_CANONICAL_VESTING_EVENT` (and the spec objects) with no principled reason; OCF treats `comments`
  as the sanctioned free-text annotation on every object. Bring it back.

### Why this honors OCF's own rationale

OCF forbids extra properties deliberately. Verbatim, from
`docs/explainers/DesignPatterns.md` ("Don't Add Additional Properties to OCF"):

> We do not want the OCF Types and OCF Objects that are meant for use by the community to have
> additional properties. This prevents situations where third-party implementers add custom or
> undocumented fields and types, which could cause:
> - **Unanticipated compatibility issues** when sharing cap tables between systems
> - **Name collisions with future versions of OCF**, if a popular implementation uses a custom
>   property name that we later want to add to the official standard
> - **Loss of interoperability**, which is the core goal of OCF
>
> If you need to store additional metadata, use the `comments` field available on all OCF Objects, or
> maintain a separate mapping table in your system that links OCF object IDs to your custom data.

All three harms are **collision/governance** harms, and a **namespaced** channel eliminates each:
core fields and `ext["namespace"]` content live in disjoint name-spaces, so the "name we later want to
add" can never collide. Note also: the strictness is scoped to *final* objects (primitives already
allow additions for composition), and **OCF already prescribes `comments` or a sidecar mapping table**
keyed by object id — which means our zero-schema-change fallback (a true sidecar keyed by `event_id`)
is *literally OCF's sanctioned pattern today*. The `ext` channel is the **governed, structured
evolution** of that same guidance — not a departure from it.

### Consistent with "no pending field"

The `ext` channel carries the event's **meaning** (spec-time intent), never its **state**. Pending is
still the absence of a witness in core. "No pending field anywhere, by design" remains true — we added
a *meaning* channel, not a *state* channel.

---

## Part V — Designing the extension mechanism for OCF

vestlang is the **first** extension, so this doc implicitly proposes the framework. The reference
model is **HL7 FHIR's extension system** (a durable, multi-party, layered interchange with opt-in
extensions — the closest analog), with lessons from Protocol Buffers, JSON-LD, and the HTTP header
registry.

### What vestlang decides (specify in this design)

- **Two-tier channel: `ext` (must-ignore) vs `modifierExt` (must-understand).** FHIR's keystone: a
  *plain* extension is purely additive — ignoring it still yields a correct core interpretation; a
  *modifier* extension changes meaning, so a consumer that doesn't understand it must **refuse** the
  element rather than silently proceed. **vestlang's event definition is classified plain/ignorable**
  (a core consumer skipping it correctly sees an opaque pending event). The framework must support
  both tiers even though vestlang needs only the plain one — that vestlang needs no modifier extension
  is itself a good sign.
- **Reference core by stable id, never by position.** Extensions point into core via `event_id` (the
  opaque surrogate) — the discipline already embodied by the source-map keying.
- **Lossless passthrough.** A tool that reads → edits → writes OCF MUST preserve extensions it doesn't
  understand (Protobuf's unknown-field rule). Without this, the first extension-blind tool in a
  pipeline silently destroys the data.
- **Layered validation.** Core-conformance must pass with unknown extensions present (hence `ext` as a
  carved-out known property, not relaxed `additionalProperties`); extension-aware validators check the
  payload against the extension's own schema.

### What to raise for the coalition (governance, not vestlang's to decide)

- **Namespace scheme (decided): owned, resolvable identifiers** — canonical URLs (e.g.
  `vesting.vestlang.dev/v1`), not bare strings. FHIR uses canonical URLs precisely to prevent the
  collisions OCF fears and to make unknown extensions discoverable (the URL dereferences to the
  extension's spec). vestlang's near-term **sidecar** may use a short interim `vestlang` key until the
  registry exists. **Open to the coalition:** the **registry** that backs the URL space (cf. the HTTP
  `X-` deprecation, RFC 6648) — governance, not vestlang's to decide.
- **Versioning + self-description.** Each extension payload declares its version so a consumer can
  decide understand / ignore / refuse.
- **Security/trust for *executable* extensions.** vestlang's payload is effectively a small program
  (re-resolved at rehydration). Treat extension payloads as **untrusted input**: sandbox evaluation,
  guard against injection and pathological combinators (resource exhaustion). For financial data this
  is a real trust boundary — and an argument *for* the plain classification (evaluation is opt-in, so
  exposure is opt-in).
- **Governance: no-duplication + graduation.** An extension must not re-encode what core already
  models. Widely-adopted extensions should have a path to **graduate into core** (FHIR migrates common
  extensions into base resources; HTTP graduated `X-` headers).

vestlang serves as the **"happy path" exemplar**: plain, id-keyed, versioned, self-describing,
losslessly preserved, opt-in to evaluate.

---

## Part VI — Carta (downstream export)

None of the above requires Carta; **canonical is the target.** Carta matters only at the export edge,
and its model re-fuses what canonical separates (rule + evaluation status). The one open Carta
question — *which* field a canonical EVENT statement lowers into, `milestoneName` vs.
`performanceCondition` — is an **export-mapping detail**, asked in `carta-vesting-question-email.md`.
The source-map definition *could* surface downstream via `milestoneName`, but that's an export choice,
out of scope here. Canonical's shape (`event_id` + `ext.vestlang` definition) is the same either way.

---

## Implementation approach & cross-repo coordination

- **Ship on the sidecar (the OCF-sanctioned mapping table).** extended emits the source map; the
  shipped, consumer-facing persistence is a **separate mapping keyed by `event_id`** — exactly the
  "separate mapping table that links OCF object IDs to your custom data" the OCF Design Patterns doc
  endorses (interim short `vestlang` key). This is zero-schema-change and fully OCF-conformant *today*,
  so it doesn't block on the coalition. (Trade-off accepted: the canonical artifact alone is opaque,
  and the sidecar must not be dropped — see Part IV's un-evaluatable-milestone caveat.)
- **Propose `ext` as the governed, in-band evolution.** Prototype the two-tier `ext`/`modifierExt`
  channel + restored `comments` in vestlang's *own* canonical (`@vestlang/core` types / local canonical
  JSON) to demonstrate it, then file conforming issues upstream:
  - **OCF-Composed-Schemas** — add the `ext`/`modifierExt` channel (owned-URL keys) to canonical
    objects; restore `comments`; add the event-definition extension; (carry forward the
    time-based-cliff change if not already tracked).
  - **OCF-Tools** — conforming changes (tolerate/preserve `ext`) so the published `@vestlang/core`
    consumer stays aligned. (Demonstrating `ext` in core output is what makes adopting it non-breaking
    there — hence we keep the *shipped* persistence on the sidecar until that lands.)
- The resolver/lowering code change itself (let an EVENT-anchored / collapsible-combinator start build
  into the template; emit `template` + runtime + source map; rehydration entry point) is a later
  `doc-stage` / `doc-implement` pass.

---

## Scope

### Included

- Case 1 (atomic unfired event → `template`; classify on the spec; the HYBRID-bug fix).
- Case 2 (combinator-over-anchors **at the start** → `template` via synthetic event + source map).
- The source map + rehydration mechanism (rehydration = re-resolution → witness; frozen template).
- The opaque, **grant-scoped surrogate** `event_id` (content-addressing *and* DSL-as-id both rejected).
- The four-arm output contract (`template`/`events-only`/`unresolved`/`impossible`).
- The `ext` channel proposal on canonical + restored `comments`.
- The OCF extension-mechanism framework (vestlang as charter example).

### Deferred

| Item | Why |
|---|---|
| The resolver/lowering + rehydration **code** | Later `doc-stage`/`doc-implement`. |
| Filing the upstream OCF-Composed-Schemas / OCF-Tools **issues** | After vestlang-local proving. |
| **Combinator / event cliffs as templates** | The firing partitions the grid → selects a structure, so pending → `unresolved`, resolved → concrete/`events-only` (Part II close). A pending-template form would need an event-referencing core cliff that computes the lump at projection time — a change to core cliff semantics, out of scope. |
| **Closed-world impossibility + `EARLIER_OF` back-dated re-resolution** | Detecting `impossible` from a non-firing, and an early-resolving `EARLIER_OF`, both ride the closed-world read; a back-dated firing re-resolves. An engine-semantics question (Stage D), to settle when the resolver/lowering lands. |
| **Partial payouts** | canonical's witness already carries `realized_fraction`; vestlang has no variable-payout concept yet (binary firing is a strict subset). |
| **Modifier-extension** cases | vestlang needs only the plain tier; the framework reserves `modifierExt` for future extensions. |
| Registry / namespace governance | Coalition's to decide (raised in Part V). |
| Market/performance-metric conditions, acceleration, post-termination | canonical already declares these out of scope. |

## Decisions resolved in this review

These four were open going in and are now settled:

1. **Namespace scheme → owned, resolvable URLs** (e.g. `vesting.vestlang.dev/v1`) as the framework
   rule — collision-proof + dereferenceable. vestlang's near-term sidecar may use a short interim
   `vestlang` key. The backing **registry** remains coalition governance (Part V).
2. **Rollout → ship on the sidecar, propose `ext`.** The sidecar (OCF's sanctioned mapping table keyed
   by `event_id`) is what vestlang ships — zero schema change, conformant today. `ext` is the in-band
   evolution we prototype in vestlang-local canonical and propose upstream (Implementation approach).
3. **Id → opaque, grant-scoped surrogate** (`evt_<grantref>_<ordinal>`), minted once and **preserved,
   not recomputed**, on round-trips. Content-addressing is rejected — used in no workflow, wrong across
   grants, and a round-trip liability (Part III). Human legibility lives in an optional `label` in the
   definition entry, never in the id.
4. **Channel shape → two-tier `ext` / `modifierExt`.** Safety is structural, not a flag; vestlang uses
   only the plain `ext` tier, and `modifierExt` is reserved/specified for future meaning-changing
   extensions (Part V).

### Still open (for the coalition, not this doc)

- The extension **registry / governance** that backs the URL namespace.
- Versioning convention and the **graduation** path from extension into OCF-core (Part V).

## References

- **OCF — Design Patterns explainer** — `docs/explainers/DesignPatterns.md` in
  `Open-Cap-Table-Coalition/Open-Cap-Format-OCF` (the `additionalProperties: false` rationale; verbatim
  passage quoted in Part IV).
  <https://open-cap-table-coalition.github.io/Open-Cap-Format-OCF/explainers/DesignPatterns/>
- **canonical schemas** — `~/code/OCF-Composed-Schemas/canonical/vesting/VestingScheduleTemplate.schema.json`,
  `~/code/OCF-Composed-Schemas/canonical/transactions/vesting/VestingEvent.schema.json` (+ its
  `.mapping.md`); OCF's `objects/transactions/vesting/VestingEvent.schema.json` (the `comments` field).
- **HL7 FHIR extension model** — the reference for plain vs. modifier extensions, canonical-URL
  namespacing, and graduation.
- **Code refs (worktree)** — `packages/evaluator/src/resolve/lower.ts` (`buildTemplate`, `:182`,
  `:189`, `:213`, `:216`), `packages/evaluator/src/resolve/classify.ts`,
  `packages/evaluator/src/evaluate/selectors.ts` (`EARLIER_POLICY`/`LATER_POLICY`),
  `packages/evaluator/src/evaluate/vestingNode/vestingBase.ts` (`:19`, asOf-gating),
  `packages/core/src/compile.ts` (`:166`, `:201`), `packages/types/src/evaluation.ts` (the `fidelity`
  field + the four-arm `EvaluatedSchedule`).
- `docs/core-extended-split.md` — the fidelity ladder; this doc revises its `:76` and `:131`.
- `docs/carta-vesting-question-email.md` — the open Carta export-mapping question.
