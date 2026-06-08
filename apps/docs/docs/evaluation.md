---
title: Evaluation
sidebar_position: 4
---

Evaluation resolves a vesting program against runtime — the grant date, the share count, and which events have fired — and produces an **`EvaluatedSchedule`**: a sequence of dated, integer-allocated installments plus a single program-level **`status`** verdict.

There are two levels to read, and they're distinct:

- **`status`** — the verdict for the whole schedule: `template`, `events-only`, `unresolved`, or `impossible`.
- **`state`** — each individual installment's own resolution: `RESOLVED`, `UNRESOLVED`, or `IMPOSSIBLE`.

## The evaluator

For each statement the evaluator:

1. Resolves the **vesting start** (a concrete date, or symbolic if it waits on an event).
2. Builds the periodic **installment dates** (concrete or symbolic).
3. Accrues any installments scheduled before the grant date onto the grant date (see [below](#vesting-start-before-grant-date)).
4. Applies an explicit **`CLIFF`** if present (including partial knowledge for `LATER OF` cliffs, [below](#partial-knowledge-for-later-of)).
5. **Allocates** the amount across installments (cumulative round-down by default, exact-rational so the rounded shares telescope to the grant exactly).
6. **Classifies** the result into a `status` verdict and emits the installments.

A whole multi-statement program collapses to **one** `EvaluatedSchedule` — never a fan-out.

**Allocation is exact.** Amounts are split by cumulative round-down in exact rational arithmetic, so the rounded integers telescope to the grant with no drift. For example `100 VEST OVER 3 months EVERY 1 month` over 100 shares vests `33, 33, 34` — each tranche is `floor(100 × i/3) − vestedSoFar` — summing to exactly 100.

## Evaluation context

```ts
{
  events: { grantDate: OCTDate } & Record<string, OCTDate | undefined>,
  grantQuantity: number,
  asOf: OCTDate,
  vesting_day_of_month?: VestingDayOfMonth,   // default VESTING_START_DAY_OR_LAST_DAY_OF_MONTH
}
```

- **`events`** — `grantDate` is required; supply any named events the DSL references (e.g. `ipo`). When the vesting start resolves, it's added back as `vestingStart` so a cliff can refer to it.
- **`grantQuantity`** — the share count the amounts allocate against.
- **`asOf`** — the date a scenario is evaluated against. Required at the library boundary; the CLI and MCP front-ends default it to today. It decides whether a time-limited condition has elapsed: a deadline still in the future keeps a pending event `unresolved` rather than `impossible`.
- **`vesting_day_of_month`** — an optional OCF convention field, with the canonical default shown above. Allocation is always cumulative round-down — the interchange has no allocation field.

All dates are `OCTDate` — an ISO `YYYY-MM-DD` string.

## The fidelity ladder (`status`)

Every evaluated program lands on exactly one `status`. The verdict reports, honestly, how much of the intent the canonical interchange can hold.

| `status` | Meaning | The schedule carries |
| :-- | :-- | :-- |
| **`template`** | Resolvable and fits canonical's one-template shape — the spec is preserved | `template`, `runtime`, `sourceMap`, resolved `installments`, `blockers` |
| **`events-only`** | Resolves to dated amounts but can't be one template — facts kept, intent lost | resolved `installments`, a `reason`, `blockers` |
| **`unresolved`** | Pending — can't be materialized yet (an unfired event) | `installments` (symbolic, plus any resolved siblings), `blockers` |
| **`impossible`** | Unsatisfiable — no event assignment can ever resolve it | impossible `installments`, `blockers` |

```ts
type EvaluatedSchedule =
  | { status: "template";    template; runtime; sourceMap; installments; blockers }
  | { status: "events-only"; installments; reason; blockers }
  | { status: "unresolved";  installments; blockers }
  | { status: "impossible";  installments; blockers };
```

`sourceMap` (on a `template`) records the DSL behind any synthetic event the lowering had to mint — e.g. when a `FROM EARLIER OF(…)` start is externalized as a single event; it is `{}` for plain schedules.

### How a program is classified

A **canonical template** is one ordered chain of installments measured from a single origin — each segment anchored to a date or a named event, with cumulative round-down allocation and duration-based cliffs. It is the shape the interchange holds and that `@vestlang/core` allocates from. Classification decides whether a program collapses to exactly that, and reports honestly when it can't.

A program is a **`template`** when, after its combinators resolve against runtime, it forms one such chain:

- one ordered sequence from a single origin — a `THEN` chain, or `PLUS` components that continue that origin — not two independent grids;
- every anchor is a date or a single coherent event (an *unfired* event is fine — see pending, below);
- any cliff is a duration, not an event;
- no unsatisfiable condition.

(Allocation is not a condition: the engine is always cumulative round-down.)

It falls to **`events-only`** when it resolves to concrete dated amounts that can't be that single shape. Two things force this:

- **overlapping absolute starts** — two independent starts that don't chain into one origin (a `PLUS` of two different dates, or one event anchoring portions that land on different dates);
- **event-anchored cliff** — the canonical cliff is a duration, so a cliff gated on an event has no template form.

The first is a verdict about *structure*: some overlapping-start programs project a stream that does have a single-template form, and the default program surfaces recover those to `template` (see [Template recovery](#template-recovery) below). The event-anchored cliff is contingent — its date depends on a firing — and is never recovered.

It is **`unresolved`** when a start or cliff genuinely can't resolve yet (an unfired event with no partial-knowledge floor), and **`impossible`** when a condition can never be satisfied.

:::note
**Pending templates.** A `template` can still be waiting on runtime: an event-anchored start that hasn't fired lowers to a `template` whose projection is empty until the event arrives, carrying `blockers`. "Representable as a template" and "fully projected" are separate — read pending from `blockers`, never from `status`.
:::

### `template`

A statement (or `THEN` chain) that resolves to a single canonical schedule. `100 VEST OVER 48 months EVERY 12 months`, grant date 2025-01-01:

| Amount | Date | State |
| --- | --- | --- |
| 25 | 2026-01-01 | RESOLVED |
| 25 | 2027-01-01 | RESOLVED |
| 25 | 2028-01-01 | RESOLVED |
| 25 | 2029-01-01 | RESOLVED |

`status: template`.

### `events-only`

Two absolute-date grids that interleave into a stream with no single-template form keep the dated facts and report why. `0.5 VEST FROM DATE 2024-01-01 OVER 4 months EVERY 1 month PLUS 0.5 VEST FROM DATE 2024-01-15 OVER 4 months EVERY 1 month`, 800 shares — one grid on the 1st, one on the 15th:

| Amount | Date | State |
| --- | --- | --- |
| 100 | 2024-02-01 | RESOLVED |
| 100 | 2024-02-15 | RESOLVED |
| … | … *(6 more, alternating)* | … |

`status: events-only` — *reason: "Two independent absolute-date vesting grids on one grant."*

### Template recovery

`events-only` is a verdict about *authored structure*, not the realized numbers. When two overlapping grids actually project a stream with a single-template form, the default program surfaces — `evaluateProgramWithRecovery`, the MCP `vestlang_evaluate_program` tool, and `vest evaluate --program` — re-infer that template and, when it reproduces the projection exactly, publish `template` with a `recovered` note instead.

`0.5 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 12 months PLUS 0.5 VEST FROM DATE 2025-07-01 OVER 12 months EVERY 12 months`, 100 shares — the two grids are really one 6-month cadence:

| Amount | Date | State |
| --- | --- | --- |
| 50 | 2026-01-01 | RESOLVED |
| 50 | 2026-07-01 | RESOLVED |

`status: template`, carrying `recovered: { from: "events-only", dsl: "100 VEST FROM DATE 2025-07-01 OVER 12 months EVERY 6 months", … }`. The raw classifier (`evaluateProgram`) still reports `events-only`; recovery only fires when the inferred template reproduces the projection exactly, and only for firing-invariant programs (no event anchors), so contingent schedules are never collapsed into a snapshot of one firing.

## Installment states

Within a schedule, each installment carries its own `state`.

### Resolved

```ts
{ amount: number, date: OCTDate, meta: { state: "RESOLVED" } }
```

### Unresolved

An installment whose date can't be fixed yet has no `date`; instead `meta` carries a **symbolic date** and the unresolved DSL fragment, and the schedule's `blockers` name what's missing.

```ts
{ amount: number, meta: { state: "UNRESOLVED", symbolicDate: SymbolicDate, unresolved: string } }
```

`100 VEST FROM EVENT milestone` (milestone unfired):

| Amount | Symbolic date | State | Unresolved |
| --- | --- | --- | --- |
| 100 | `{ type: UNRESOLVED_VESTING_START }` | UNRESOLVED | `EVENT milestone` |

Blocker: `{ type: "EVENT_NOT_YET_OCCURRED", event: "milestone" }`.

A **symbolic date** takes one of three forms:

```ts
{ type: "UNRESOLVED_VESTING_START" }                          // the start itself is unknown
{ type: "START_PLUS", unit: "DAYS" | "MONTHS", steps: number } // a known offset from an unknown start
{ type: "UNRESOLVED_CLIFF", date: OCTDate }                    // grid date known, cliff gate unfired
```

The **`unresolved` blockers**:

```ts
type UnresolvedBlocker =
  | { type: "EVENT_NOT_YET_OCCURRED"; event: string }
  | { type: "DATE_NOT_YET_OCCURRED"; date: OCTDate }
  | { type: "UNRESOLVED_SELECTOR"; selector: "EARLIER_OF" | "LATER_OF"; blockers: Blocker[] }
  | { type: "UNRESOLVED_CONDITION"; condition: Omit<VestingNode, "type"> };
```

### Impossible

A condition that can never be satisfied — no event assignment resolves it.

```ts
{ amount: number, meta: { state: "IMPOSSIBLE", unresolved: string } }
```

`100 VEST FROM EVENT milestone BEFORE DATE 2025-01-01`, evaluated after the deadline has passed (the event never fired, so the start can never occur):

| Amount | State | Unresolved |
| --- | --- | --- |
| 100 | IMPOSSIBLE | `EVENT milestone BEFORE DATE 2025-01-01` |

Blocker (the `condition` is the offending node, minus its `type`):

```json
{
  "type": "IMPOSSIBLE_CONDITION",
  "condition": {
    "base": { "type": "EVENT", "value": "milestone" },
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

When a `LATER OF` selector has some but not all items resolved, the resolved items still constrain the result. Consider a 4-year quarterly schedule whose cliff is the *later* of 12 months and a milestone, granted 2025-01-01 over 100 shares:

```vest
100 VEST
  OVER 48 months EVERY 3 months
  CLIFF LATER OF( +12 months, EVENT milestone )
```

With `milestone` unfired the cliff date is unknown — but a `LATER OF` can only push the cliff *later* than the 12-month floor, so we already know nothing vests before that floor. The schedule is `unresolved`, yet every installment carries the 12-month cliff:

| Amount | Symbolic date | State | Unresolved |
| --- | --- | --- | --- |
| 25 | `{ type: UNRESOLVED_CLIFF, date: 2026-01-01 }` | UNRESOLVED | EVENT milestone |
| 6 | `{ type: UNRESOLVED_CLIFF, date: 2026-04-01 }` | UNRESOLVED | EVENT milestone |
| … | … *(through 2029-01-01)* | … | … |

### Vesting start before grant date

Awards are often granted with a vesting start that precedes the grant date, to give credit for service already provided. The evaluator accrues every installment before the grant date onto the grant date. A 4-year quarterly schedule starting 2024-01-01, granted 2025-01-01 over 100 shares:

```vest
100 VEST FROM DATE 2024-01-01
  OVER 48 months EVERY 3 months
```

The four 2024 installments accrue and vest together on the grant date:

| Amount | Date | State |
| --- | --- | --- |
| 25 | 2025-01-01 | RESOLVED *(accrued 2024 catch-up)* |
| 6 | 2025-04-01 | RESOLVED |
| … | … *(through 2028-01-01)* | … |
