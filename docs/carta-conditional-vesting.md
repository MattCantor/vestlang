# Carta Conditional Vesting & the Fidelity Boundary

How Carta's Cap Table Data Schema expresses **pending / unresolved** vesting, where
vestlang's contingency axis maps cleanly onto it, where it doesn't — and a proposed
refinement to vestlang's fidelity verdict that follows directly from the mapping.

## Status

- **Status**: Concept — findings + design proposal (not yet staged for implementation).
- **Priority**: Medium
- **Complexity**: Medium
- **Interchange target**: Carta Cap Table Data Schema **v1alpha1** (2026-04-30),
  `~/code/OCF-Composed-Schemas/target-schema/Carta.schema.json`.
- **Relates to**: `docs/core-extended-split.md` (the core/extended split and the
  template / events-only / unresolved fidelity ladder this refines),
  `docs/simple-vesting-spec.md` (the OCF-aligned simple vesting target).

---

## Overview

vestlang classifies every resolved program by **interchange fidelity** — `template`
(fits one canonical template), `events-only` (resolves to dated amounts but can't be one
template), or `unresolved` (can't be materialized yet: an unfired event or a contradiction).
The `unresolved` level was treated as a single bucket: "the interchange can't hold this yet."

Reading Carta's schema shows that is **too coarse**. Carta has a *first-class, template-level*
representation for a pending condition — a `PerformanceCondition` with
`status: NOT_EVALUATED`. So an atomic unfired event gating a vesting **period** is not a
fallback at all: it round-trips as a structured `MILESTONE`/`HYBRID` template. What Carta
genuinely *cannot* hold is narrower than "anything unresolved": it's the **combinator** (the
*later of* a date and an event) and the **event-anchored cliff**.

This doc (1) documents exactly how Carta encodes pending vesting, (2) maps vestlang's
conditional constructs onto Carta's expressibility boundary, and (3) proposes splitting
vestlang's `unresolved` verdict so that Carta-template-expressible pending conditions are
reported as such instead of being lumped with the genuinely-unrepresentable cases.

---

## How Carta expresses pending vesting

Carta encodes "pending / not-yet-determined" vesting in **two complementary places**: the
schedule *definition* (forward-looking) and the *materialized* per-tranche events.

### 1. Definition side — `PerformanceCondition.status = NOT_EVALUATED`

A grant references **one** template and **one** start
(`Vesting { templateId, startDate, acceleration }`). The template is:

```
VestingScheduleTemplate {
  vestingScheduleType: DATE | MILESTONE | HYBRID
  periods: VestingPeriod[]
}
```

`vestingScheduleType` (per the schema's own description): `DATE` = calendar-date tranches;
`MILESTONE` = tranches gated on a milestone condition; `HYBRID` = a mix of date-based tranches
and performance conditions.

Each period can carry a condition two ways — a bare named milestone, or a structured
performance condition:

```
VestingPeriod {
  order, percentage, vestingMethod, vestingOccurs,
  length, lengthUnit, immediatePercentage,
  cliffPercentage, cliffLength, cliffLengthUnit,     // cliff is TIME-BASED only
  milestoneName: string,                             // a named milestone, or…
  performanceCondition: PerformanceCondition          // …a structured condition
}

PerformanceCondition {
  name, description,
  type:   PERFORMANCE_NON_MARKET | MARKET | EVENT_NON_MARKET
  status: ACHIEVED | NOT_ACHIEVED | NOT_EVALUATED      // ← "pending" lives here
  evaluationDate,                                       // when it is/was assessed
  payoutPercentage, minPayoutPercentage, maxPayoutPercentage,   // variable payout
  vestsPostTermination
}
```

**`status: NOT_EVALUATED` is Carta's first-class "unresolved" marker.** A corporate event
like an IPO is `type: EVENT_NON_MARKET` (vs. `MARKET` = a stock-price target, vs.
`PERFORMANCE_NON_MARKET` = e.g. a revenue target). So a period that vests "on the IPO,"
before the IPO has happened, is a fully-valid template: a `MILESTONE`/`HYBRID` template with a
`performanceCondition { type: EVENT_NON_MARKET, status: NOT_EVALUATED }`.

### 2. Materialized side — per-tranche flags

The realized vesting stream (`OptionGrantVestingEvent`, `RestrictedStockAwardVestingEvent`,
`RestrictedStockUnitVestingEvent`) expresses pending tranches with **booleans + quantity
splits**, not a status enum:

```
*VestingEvent {
  id, quantity,
  vestDate?: Iso8601CompleteCalendarDate    // OPTIONAL — pending tranches need no date
  vested: boolean                            // false = not yet vested
  performanceCondition: boolean              // true = this tranche IS gated…
                                             //   (the schema is explicit: indicates a
                                             //    condition EXISTS, not that it is met)
  targetQuantity, maxQuantity, vestedQuantity
}
```

**Verified: none of these fields are `required`**, so `vestDate` may be absent. A pending
performance tranche is `vested: false`, `performanceCondition: true`, no firm `vestDate`,
`targetQuantity` set, `vestedQuantity` 0/absent. The variable-payout range lives in
`targetQuantity` (expected) vs. `maxQuantity` (cap) vs. `vestedQuantity` (realized).

---

## The conditional-vesting expressibility boundary

Putting the two sides together, here is where vestlang's contingency constructs land against
Carta. This is the sharpened version of core-extended-split's "the DSL's only axis over core
is unresolved intent."

| vestlang construct | Carta representation | Verdict |
|---|---|---|
| **Atomic event gating a period** — `PORTION 25% ON EVENT "ipo"`, unfired | `MILESTONE`/`HYBRID` period + `PerformanceCondition { type: EVENT_NON_MARKET, status: NOT_EVALUATED }` | ✅ **template-expressible** — a structured, round-tripping template |
| **Event-anchored cliff** — `CLIFF EVENT "ipo"` | No event anchor *on* the cliff: `cliffLength`/`cliffLengthUnit`/`cliffPercentage` are time-based only. The lump must be re-modeled as a *separate* milestone period. | ⚠️ **no native cliff form** — re-expressible structurally, but not as a cliff |
| **Combinator over anchors** — `LATER OF(+12 months, EVENT "ipo")` | No "max of a date and an event." A period can carry a time-based cliff *and* a performance condition, but nothing expresses *the later of the two*. | ❌ **no template form** |

The key correction to the earlier mental model: the boundary is **not** "resolved vs.
unresolved." Carta holds an *unresolved atomic* condition fine (`NOT_EVALUATED`). The boundary
is **atomic condition vs. combinator** — a condition whose resolution would *select among
different structures* (the combinator) is what has no home, exactly as the cliff redesign and
the recent LATER-OF cliff fix surfaced.

---

## Implication for vestlang's fidelity verdict

vestlang's `unresolved` arm currently conflates two cases that Carta treats very differently:

1. **Atomic pending event** (a single named, unfired `EVENT` gating a period). Carta stores
   this **in the template** as `NOT_EVALUATED`. vestlang calling it `unresolved` *under-sells*
   what the interchange can hold — it reports a fallback where a structured template exists.
2. **Pending combinator / event-cliff / contradiction.** Genuinely no template form. Correctly
   `unresolved` (or `events-only`).

### Proposal — split the pending case

Recognize the atomic-pending case as **template-expressible** rather than `unresolved`:

- **Classifier:** distinguish a period gated by a *single named event* (atomic) from a period
  gated by a *combinator*. The former lowers to a canonical EVENT statement carrying a pending
  marker; the latter stays `unresolved`/`events-only`.
- **IR:** let a canonical EVENT statement carry an optional **pending-condition** descriptor
  (`status: NOT_EVALUATED`, `type: EVENT_NON_MARKET`, optional `evaluationDate`) so it lowers
  to a Carta `MILESTONE`/`HYBRID` period rather than vanishing into symbolic installments.
- **Verdict surface:** either fold atomic-pending into `template` (with condition metadata on
  the installments), or introduce a distinct tag (e.g. `template-pending`) so callers can tell
  "structured but awaiting an event" from "fully resolved." (Open question below.)
- **Projection:** a pending tranche maps to a `*VestingEvent` with `vested: false`,
  `performanceCondition: true`, and **no `vestDate`** — which is exactly what vestlang's
  symbolic (dateless) installment already represents.

The event-anchored **cliff** and the **combinator** are explicitly *out* of this refinement —
they remain `unresolved`/`events-only` because Carta has no structured form for them. This
proposal only reclassifies the case Carta demonstrably *can* hold.

---

## Scope

### Included

- The Carta encoding of pending vesting (definition + materialized sides), with exact field
  names from the v1alpha1 snapshot.
- The expressibility-boundary mapping (atomic period / event-cliff / combinator).
- A proposal to split vestlang's `unresolved` so atomic-pending events are reported as
  Carta-template-expressible, plus a sketch of the IR/classifier/projection changes.

### Deferred

| Item | Why |
|---|---|
| **Implementation** (classifier + IR + assembler changes) | This doc is findings + proposal; staging/implementation is a later `doc-stage` / `doc-implement` pass. |
| **Variable payout** (`min`/`max`/`payoutPercentage`) | vestlang has no variable-payout concept; mapping Carta's payout range is its own design question. |
| **Market conditions** (`type: MARKET`) | Stock-price targets aren't in vestlang's DSL. |
| **`acceleration`, `vestsPostTermination`, `evaluationDate` semantics** | Modeled by Carta; not yet by vestlang. Carry-through only. |

---

## Open questions

1. **One tag or two?** Fold atomic-pending into `template` (with per-installment condition
   metadata), or add a distinct `template-pending` verdict so consumers can branch on "awaiting
   an event" without inspecting installments?
2. **`milestoneName` vs. `performanceCondition`.** Carta offers a bare named milestone *and* a
   structured condition. Which does a vestlang `EVENT "ipo"` lower to — the lighter
   `milestoneName`, or the full `PerformanceCondition` (enabling type/status/evaluationDate)?
3. **Condition typing.** vestlang only has named `EVENT`s. Do they all map to `EVENT_NON_MARKET`,
   or does vestlang need to distinguish market / performance / event gates to populate
   `PerformanceConditionType` faithfully?
4. **Materialized round-trip.** Confirm that emitting a pending `*VestingEvent` with no
   `vestDate` + `performanceCondition: true` is accepted by downstream Carta consumers (the
   schema permits it; real ingestion may be stricter).

---

## References

- **Carta Cap Table Data Schema** v1alpha1 (2026-04-30) —
  `~/code/OCF-Composed-Schemas/target-schema/Carta.schema.json`. Relevant `$defs`:
  `VestingScheduleTemplate`, `VestingPeriod`, `PerformanceCondition`,
  `PerformanceConditionType`, `PerformanceConditionStatus`, `Vesting`,
  `OptionGrantVestingEvent`, `RestrictedStock{Award,Unit}VestingEvent`, `VestingScheduleType`.
- `docs/core-extended-split.md` — the fidelity ladder this refines.
- `docs/simple-vesting-spec.md` — the OCF-aligned simple vesting target.
