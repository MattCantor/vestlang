---
title: Evaluation
sidebar_position: 4
---

Evaluation resolves a vesting program against runtime — the grant date, the share count, and which events have fired — and produces an **`EvaluatedSchedule`**: dated, integer-allocated installments and **two verdicts**, side by side.

Two verdicts, because "what could a cap-table system store for this schedule" and "what does it work out to given the events we currently know" are different questions with different answers:

- **`interchange`** — the **storable** verdict. What a record keeper could hold for this schedule, asked _without looking at which events have fired_. Because it ignores firings, a later event can never change it — so it's the answer that's safe to persist.
- **`resolution`** — the **resolves-to** verdict. What the schedule works out to _given the events currently known_, taken as the whole world. It reads firings, so it moves as events arrive.

```ts
interface EvaluatedSchedule {
  interchange: InterchangeVerdict; // storable floor — never reads firings
  resolution: EvaluatedScheduleVerdict; // resolves-to — closed-world, reads events
  absenceAssumptions: AbsenceAssumption[]; // events the resolves-to reading leans on
  findings: Finding[]; // schedule advisories — allocation (over / under), precision (a stored percentage too coarse to allocate exactly), and event-id case near-misses
}
```

Each verdict is a `status` plus the payload that status carries (installments, a `reason`, `blockers`). The CLI and MCP front-ends flatten all of this into a `ScheduleView` — the two verdicts, the installments, the blockers, and three [read-flags](#read-flags).

## The two verdicts

|                     | **Interchange** ("Storable")              | **Resolution** ("Resolves to")                        |
| :------------------ | :---------------------------------------- | :---------------------------------------------------- |
| Question            | what can a record keeper store?           | what does it resolve to, given known events?          |
| Reads firing dates? | never — firing-invariant                  | yes                                                   |
| `status` values     | `template` / `events-only` / `unrepresentable` / `impossible` | `template` / `events-only` / `unresolved` / `impossible` |
| Role                | the stored floor                          | the analysis overlay                                  |

The values they share mean the same thing in both lenses:

- **`template`** — fits canonical's one-template shape, so the spec is preserved exactly.
- **`events-only`** — resolves to concrete dated amounts that can't be one template (carries a `reason`); the facts survive, the single-template intent doesn't.
- **`impossible`** — a contradiction no assignment of events could ever satisfy.

They differ only on the pending case, because they're asking different things:

- **`unresolved`** is **resolution-only** — the closed-world "can't be materialized yet" (typically a cliff that needs a firing date to place its lump). The interchange lens never consults firings, so it has no pending state of its own.
- **`unrepresentable`** is **interchange-only** — there's no storable shape at all, not even as bare events. Two causes remain today: a **cross-unit deferred cliff** (a cliff whose duration is in a different unit than the grid, so it can't be placed until a firing is known) and a **`THEN` tail behind an unfired start** (a chained segment that just can't be dated yet). An event-anchored cliff is **not** one of them anymore — it stores as a `template`, a time `cliff` plus an `event_condition` (see the [divergence example](#when-the-two-diverge) below). The interchange lens never consults firings, so it has no pending state of its own.

### When the two diverge

Keeping both is the whole point — the same schedule can land differently in each lens:

- A **gated start** `VEST FROM DATE 2025-01-01 BEFORE EVENT ipo` is a storable **`template`** (the gate's definition rides across as a synthetic event). But if `ipo` is already on record at `2024-06-01` — before the 2025 start it was meant to precede — the resolves-to verdict is **`impossible`**. Storable floor: `template`; this-world reading: `impossible`.
- An **event-anchored cliff** `VEST OVER 48 months EVERY 1 month CLIFF EVENT ipo` stores as a **`template`** — a time `cliff` (a zero-length hold) plus an `event_condition` carrying the `ipo` gate — and with `ipo` unfired it _resolves to_ **`template`** as well. The two verdicts agree here; what moves is the projection: it's a pending template (`representable: true`, `pending: true`), its grid emitted symbolically with each installment held under the `ipo` gate, and the dated stream stays empty until `ipo` is recorded.

### Read-flags

The flattened `ScheduleView` derives three booleans, each from a different source — read each from its own flag, not from a `status`:

- **`representable`** — from the **interchange** verdict: can a record keeper hold this at all?
- **`pending`** — from the **blockers**: are witnesses (unfired events) still missing? A storable `template` can be pending — its projection stays empty until the event arrives.
- **`valid`** — from the **findings**: is at most 100% of the grant allocated? This is about what was written, independent of either verdict and of which events fired.

:::note
`representable` and "fully projected" are separate axes. An event-anchored start that hasn't fired is a perfectly storable `template` whose projection is empty for now — `representable: true`, `pending: true`. Always read pending from `pending` / `blockers`, never from a `status`.
:::

## Absence assumptions

Closed-world resolution reads "no firing on record" as "hasn't happened." So the resolves-to verdict can quietly lean on an event _staying_ absent — and if that event is later recorded (even backdated), the answer changes. `absenceAssumptions` discloses every such dependency:

```ts
interface AbsenceAssumption {
  eventId: string;
  through: OCTDate; // inclusive: "did not occur on or before this date"
}
```

`VEST FROM DATE 2025-01-01 BEFORE EVENT ipo` (ipo unfired) holds as a pending template only as long as `ipo` stays absent through `2025-01-01` — record `ipo` on or before that date and the gate fails, flipping it to `impossible`. So it discloses `{ eventId: "ipo", through: "2025-01-01" }`. The list is a watch-list of the firings (including backdated ones) that would move the result: a date-only or fully-fired schedule discloses none.

A bare `VEST FROM EVENT ipo` — no `BEFORE`/`AFTER` date to measure against — is simply pending. It has no _dated_ assumption, so it discloses nothing and surfaces only as a blocker.

## Gate provisos (`BEFORE` / `AFTER`)

A `BEFORE`/`AFTER` proviso — "vest from X, so long as it lands before/after Y" — compares two dates. You can only decide it against dates you actually know:

- **Two known dates** (a literal date, or an event already on record) — compared directly; the proviso holds or it doesn't, and the answer never drifts with the clock.
- **An unfired event on either side** — _pending_, never silently satisfied or impossible. An unrecorded event can still be entered later with any effective date — even one backdated across the comparison — so neither answer is safe to commit. (One exception: being `AFTER` an event the schedule has established can _never_ occur is impossible — you can't be after something that never happens.)

So **`impossible` is reserved for a structural contradiction** — a date forced before a strictly earlier date — not for "an event hasn't fired yet":

- `VEST FROM DATE 2025-06-01 BEFORE DATE 2025-01-01` → **`impossible`** (June can't precede January).
- `VEST FROM EVENT milestone BEFORE DATE 2025-01-01`, `milestone` unfired → **pending**, even long past that date — the milestone could still be recorded with an earlier effective date. (It discloses an absence assumption on `milestone` through `2025-01-01`.)

## The evaluator

For each statement the evaluator:

1. Resolves the **vesting start** (a concrete date, or symbolic if it waits on an event).
2. Builds the periodic **installment dates** (concrete or symbolic).
3. Accrues any installments scheduled before the grant date onto the grant date (see [below](#vesting-start-before-grant-date)).
4. Applies an explicit **`CLIFF`** if present (including partial knowledge for `LATER OF` cliffs, [below](#partial-knowledge-for-later-of)).
5. **Allocates** the amount across installments (cumulative round-down by default, exact-rational so the rounded shares telescope to the grant exactly).

A whole multi-statement program then collapses to **one** `EvaluatedSchedule` — never a fan-out — which is **classified** into the two verdicts and carries the merged installments and a single allocation finding if the amounts don't sum to the grant.

**Allocation is exact.** Amounts are split by cumulative round-down in exact rational arithmetic, so the rounded integers telescope to the grant with no drift. For example `100 VEST OVER 3 months EVERY 1 month` over 100 shares vests `33, 33, 34` — each tranche is `floor(100 × i/3) − vestedSoFar` — summing to exactly 100.

Because each tranche floors the running cumulative, an installment that the schedule allocates **0 shares** is dropped — it isn't emitted as a tranche. This only bites at small quantities, where a lump that would carry a few shares at a larger grant rounds away entirely: a pre-grant accrued catch-up or a cliff lump can land on 0 and simply not appear. Shares still conserve — the count that didn't land on the elided installment stays in the pool and surfaces on a later one. For instance `VEST OVER 48 months EVERY 1 month CLIFF 12 months` over 7 shares puts `floor(7 × 12/48) = 1` on the cliff (not the naive `1.75`), and the full grid still sums to 7.

## Evaluation context

```ts
{
  grantDate: OCTDate,                          // the grant-date anchor (its own field)
  events: Record<string, OCTDate | undefined>, // genuine named events (e.g. ipo)
  grantQuantity: number,
  asOf: OCTDate,
  vesting_day_of_month?: VestingDayOfMonth,     // default VESTING_START_DAY_OR_LAST_DAY_OF_MONTH
}
```

- **`grantDate`** — the grant-date anchor, a top-level field (not an entry in `events`). When the vesting start resolves, it's overlaid as `vestingStart` so a cliff can refer to it.
- **`events`** — the genuine named events the DSL references (e.g. `ipo`). A name absent from the map is treated as unfired, not as never-occurring.
- **`grantQuantity`** — the share count the amounts allocate against.
- **`asOf`** — the clock a scenario is read against; the CLI and MCP front-ends default it to today. It's used to partition installments into vested / not-yet-vested ([`vestlang_evaluate_as_of`](./common_queries.md)); it does **not** decide whether a date is _known_ — a guaranteed-future literal date resolves like any other.
- **`vesting_day_of_month`** — an optional OCF convention field, with the canonical default shown. Allocation is always cumulative round-down — the interchange has no allocation field.

All dates are `OCTDate` — an ISO `YYYY-MM-DD` string.

## Worked verdicts

### `template`

A statement (or `THEN` chain) that resolves to a single canonical schedule. `100 VEST OVER 48 months EVERY 12 months`, grant date 2025-01-01:

| Amount | Date       | State    |
| ------ | ---------- | -------- |
| 25     | 2026-01-01 | RESOLVED |
| 25     | 2027-01-01 | RESOLVED |
| 25     | 2028-01-01 | RESOLVED |
| 25     | 2029-01-01 | RESOLVED |

Both verdicts `template`. `sourceMap` (carried on a `template`) records the DSL behind any synthetic event the lowering had to mint — e.g. when a gated or `EARLIER OF (…)` start is externalized as a single event; it's `{}` for plain schedules.

### `events-only`

Two absolute-date grids that interleave into a stream with no single-template form keep the dated facts and report why. `0.5 VEST FROM DATE 2024-01-01 OVER 4 months EVERY 1 month PLUS 0.5 VEST FROM DATE 2024-01-15 OVER 4 months EVERY 1 month`, 800 shares — one grid on the 1st, one on the 15th:

| Amount | Date                          | State    |
| ------ | ----------------------------- | -------- |
| 100    | 2024-02-01                    | RESOLVED |
| 100    | 2024-02-15                    | RESOLVED |
| …      | … _(6 more, alternating)_     | …        |

Both verdicts `events-only` — _reason: "Two independent absolute-date vesting grids on one grant."_ (Two independent `DATE` grids are purely date-anchored, so they're `events-only` in both lenses.)

### `template` (pending)

A cliff gated on an event still stores as one template — a time `cliff` plus the event gate as an `event_condition`. `100 VEST OVER 48 months EVERY 3 months CLIFF LATER OF (+12 months, EVENT milestone)`, grant 2025-01-01 over 100 shares, `milestone` unfired:

- **interchange: `template`** — the schedule is storable as written; the event hold lives in `event_condition`.
- **resolution: `template`** — but `pending: true`, because `milestone` hasn't fired (blocker `EVENT_NOT_YET_OCCURRED`).

The installments are emitted symbolically until `milestone` fires (see [Partial knowledge](#partial-knowledge-for-later-of)). The `LATER OF` floor — nothing can vest before the 12-month mark — holds when the schedule is realized, but the unfired symbolic dates currently display at their raw grid positions, not lifted to that floor (so the first row reads `2025-04-01`, below the `2026-01-01` floor). What those pending dates _should_ surface is the open question tracked in [#447](https://github.com/MattCantor/vestlang/issues/447).

### `impossible`

A structural contradiction — no assignment of events can satisfy it. `VEST FROM DATE 2025-06-01 BEFORE DATE 2025-01-01` (a June start required to precede January):

| Amount | State      | Unresolved                           |
| ------ | ---------- | ------------------------------------ |
| 100    | IMPOSSIBLE | `DATE 2025-06-01 BEFORE DATE 2025-01-01` |

Both verdicts `impossible`. Note that an unfired _event_ in a gate is **not** impossible — see [Gate provisos](#gate-provisos-before--after).

### Template recovery

`events-only` is a verdict about _authored structure_, not the realized numbers. When two overlapping grids actually project a stream with a single-template form, the default program evaluation — `evaluateProgramWithRecovery`, the MCP `vestlang_evaluate` tool, and `vest evaluate` — re-infers that template and, when it reproduces the projection exactly, publishes `template` with a `recovered` note instead.

`0.5 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 12 months PLUS 0.5 VEST FROM DATE 2025-07-01 OVER 12 months EVERY 12 months`, 100 shares — the two grids are really one 6-month cadence:

| Amount | Date       | State    |
| ------ | ---------- | -------- |
| 50     | 2026-01-01 | RESOLVED |
| 50     | 2026-07-01 | RESOLVED |

Both verdicts `template`, carrying `recovered: { from: "events-only", dsl: "100 VEST FROM DATE 2025-07-01 OVER 12 months EVERY 6 months", … }`. Without recovery, the raw classification is still `events-only`; recovery only fires when the inferred template reproduces the projection exactly, and only for firing-invariant programs (no event anchors), so contingent schedules are never collapsed into a snapshot of one firing.

## Installment states

Each installment carries its own `state`, separate from the schedule-level verdicts.

### Resolved

```ts
{ amount: number, date: OCTDate, meta: { state: "RESOLVED" } }
```

### Unresolved

An installment whose date can't be fixed yet has no `date`; instead `meta` carries a **symbolic date** and the unresolved DSL fragment, and the schedule's `blockers` name what's missing. (An unfired-event _start_ no longer produces these — it lowers to a pending `template` whose projection is simply empty; symbolic installments appear when part of a known grid still waits on a firing, like the `LATER OF` cliff above.)

```ts
{ amount: number, meta: { state: "UNRESOLVED", symbolicDate: SymbolicDate, unresolved: string } }
```

A **symbolic date** takes one of three forms:

```ts
{ type: "UNRESOLVED_VESTING_START" }                           // the start itself is unknown
{ type: "START_PLUS", unit: "DAYS" | "MONTHS", steps: number } // a known offset from an unknown start
{ type: "UNRESOLVED_CLIFF", date: OCTDate }                    // grid date known, cliff gate unfired
```

The **`unresolved` blockers**:

```ts
type UnresolvedBlocker =
  | { type: "EVENT_NOT_YET_OCCURRED"; event: string; through?: OCTDate }
  | { type: "UNRESOLVED_SELECTOR"; selector: "EARLIER_OF" | "LATER_OF"; blockers: Blocker[] }
  | { type: "UNRESOLVED_CONDITION"; condition: Omit<VestingNode, "type"> };
```

`through` on `EVENT_NOT_YET_OCCURRED` is the date the event was measured against when it has one (a gate's date, or the date a `LATER OF` settled on); it's the boundary the schedule's [absence assumptions](#absence-assumptions) report.

### Impossible

A condition that can never be satisfied — no event assignment resolves it. For `VEST FROM DATE 2025-06-01 BEFORE DATE 2025-01-01`:

```ts
{ amount: number, meta: { state: "IMPOSSIBLE", unresolved: string } }
```

Blocker (the `condition` is the offending node, minus its `type`):

```json
{
  "type": "IMPOSSIBLE_CONDITION",
  "condition": {
    "base": { "type": "DATE", "value": "2025-06-01" },
    "offsets": [],
    "condition": {
      "type": "ATOM",
      "constraint": {
        "type": "BEFORE",
        "base": { "type": "NODE", "base": { "type": "DATE", "value": "2025-01-01" }, "offsets": [] },
        "strict": false
      }
    }
  }
}
```

```ts
type ImpossibleBlocker =
  | { type: "IMPOSSIBLE_SELECTOR"; selector: "EARLIER_OF" | "LATER_OF"; blockers: ImpossibleBlocker[] }
  | { type: "IMPOSSIBLE_CONDITION"; condition: Omit<VestingNode, "type"> };
```

## Special cases

### Partial knowledge for `LATER OF`

When a `LATER OF` selector has some but not all items resolved, the resolved items still constrain the result. Consider a 4-year quarterly schedule whose cliff is the _later_ of 12 months and a milestone, granted 2025-01-01 over 100 shares:

```vest
100 VEST
  OVER 48 months EVERY 3 months
  CLIFF LATER OF (+12 months, EVENT milestone)
```

With `milestone` unfired the cliff date is unknown — but a `LATER OF` can only push the cliff _later_ than the 12-month floor, so the resolved floor still constrains the outcome: when the schedule is realized, nothing vests before that 12-month mark. The schedule stores and resolves as a `template`, with `milestone` outstanding (`pending: true`). Every installment is emitted symbolically, blocked on `EVENT milestone`:

| Amount | Symbolic date                              | State      | Unresolved     |
| ------ | ------------------------------------------ | ---------- | -------------- |
| 6      | `{ type: UNRESOLVED_CLIFF, date: 2025-04-01 }` | UNRESOLVED | EVENT milestone |
| 6      | `{ type: UNRESOLVED_CLIFF, date: 2025-07-01 }` | UNRESOLVED | EVENT milestone |
| …      | … _(through 2029-01-01)_                   | …          | …              |

A wrinkle worth flagging: those `UNRESOLVED_CLIFF` dates currently display at their _raw grid positions_ (the first reads `2025-04-01`), not lifted to the `2026-01-01` floor the `LATER OF` guarantees — and no absence assumption is surfaced for the floor. The floor still binds at realization; it just isn't reflected in the pending symbolic dates today. Whether those dates should be raised to the floor (or otherwise signal it) is the open question tracked in [#447](https://github.com/MattCantor/vestlang/issues/447).

### Vesting start before grant date

Awards are often granted with a vesting start that precedes the grant date, to give credit for service already provided. The evaluator accrues every installment before the grant date onto the grant date. A 4-year quarterly schedule starting 2024-01-01, granted 2025-01-01 over 100 shares:

```vest
100 VEST FROM DATE 2024-01-01
  OVER 48 months EVERY 3 months
```

The four 2024 installments accrue and vest together on the grant date:

| Amount | Date                          | State                          |
| ------ | ----------------------------- | ------------------------------ |
| 25     | 2025-01-01                    | RESOLVED _(accrued 2024 catch-up)_ |
| 6      | 2025-04-01                    | RESOLVED                       |
| …      | … _(through 2028-01-01)_      | …                              |

At a small enough quantity the catch-up lump can round to **0** and drop out entirely — the [cumulative round-down](#the-evaluator) elides any 0-share installment. The same schedule over **3** shares — `VEST FROM DATE 2024-01-01 OVER 48 months EVERY 3 months`, granted 2025-01-01 — produces no grant-date tranche at all: the 2024 catch-up floors to 0, and the three shares land later, on `2025-07-01`, `2026-10-01`, and `2028-01-01`. The grant date is silent, but all 3 shares still vest.
