---
title: Evaluation
sidebar_position: 3
---

## Evaluator: From AST to Tranches

Goal: turn a normalized vestlang AST into a sequence of **tranches** (installments) that are either **resolved** (with a concrete ISO date), **unresolved** (with a symbolic date and blockers), or **impossible** (with blockers).

- Input: a normalized `Program` (array of `Statements`s) and an `EvaluationContextInput`.
- Output: `Tranche[]` per statement (or `Tranche[][]` for a whole `Program`)

The evaluator:

1. Chooses (or fails to choose) a **vesting start** from a `ScheduleExpr` (handling `EARLIER OF` / `LATER OF`).
2. Builds the periodic **dates** (or symbolic dates) from the vesting period (`OVER`/`EVERY`).
3. Applies the **grant date catch up** (treating grant date as a "soft cliff", see below).
4. Applies an explicit **CLIFF** if present (including partial knowledge for `LATER OF` cliffs).
5. **Allocates** the statement's amount across installments using the configured allocation mode.
6. Emits **Tranches** with metadata.

---

## Evaluation context

```ts
{
  events: { grantDate: OCTDate } & Record<string, OCTDate | undefined>,
  grantQuantity: number,
  asOf: OCTDate,
  vesting_day_of_month: vesting_day_of_month
  allocation_type: allocation_type
}
```

### Events

The evaluation context is supplied when running the evaluator, including the grant date of the security and the quantity of shares. If the vesting start is resolved through the course of the evaluation, `EVENT vestingStart` is added to the `events` record.

### Vesting Day of Month

`vesting_day_of_month` tracks the OCT schema found [here](https://open-cap-table-coalition.github.io/Open-Cap-Format-OCF/schema_markdown/schema/types/vesting/VestingPeriodInMonths/), and defaults to `VESTING_START_DAY_OR_LAST_DAY_OF_MONTH`.

### Allocation Type

`allocation_type` tracks the OCT schema found [here](https://open-cap-table-coaltion.github.io/Open-Cap-Format-OCF/schema_markdown/schema/enums/AllocationType/), and defaults to `CUMULATIVE_ROUND_DOWN`.

### As Of Date

The `asOf` date is used to determine whether time-limited conditions have occured, and defaults to the current date if not provided.

For instance, consider a vesting schedule that starts if a milestone occurs before a given date in the future:

```
VEST FROM EVENT milestone BEFORE DATE 9999-01-01
```

If this is evaluated with an unresolved `EVENT milestone`, then the returned tranche will be `UNERESOLVED` because the event may occur, and the deadline hasn't yet elapsed.

---

## Resolved Installments

```ts
{
  amount: number,
  date: OCTDate,
  meta: {
    state: "RESOLVED"
  }
}
```

### Example: Standard Time-Based Vesting

A time-based vesting schedule without conditions always resolves. The example below assumes a grant date of 2025-01-01.

```
100 VEST OVER 4 years EVERY 1 year
```

| Amount | Date       | State    |
| :----- | :--------- | :------- |
| 25     | 2026-01-01 | RESOLVED |
| 25     | 2027-01-01 | RESOLVED |
| 25     | 2028-01-01 | RESOLVED |
| 25     | 2029-01-01 | RESOLVED |

## Unresolved Installments

Unrsolved installments have the following shape:

```ts
{
  amount: number,
  meta: {
    state: "UNRESOLVED",
    date: SymbolicDate,
    blockers: string[]
  }
}
```

Unresolved installments contain the one of the following symbolic dates:

### Before Vesting Date

```ts
{
  type: "BEFORE_VESTING_START";
}
```

```
100 VEST FROM EVENT milestone
```

| Amount | Date                            | Status     | Blockers          |
| :----- | :------------------------------ | :--------- | :---------------- |
| 100    | `{type: BEFORE_VESTING_START }` | UNRESOLVED | `EVENT milestone` |

### Start Plus

```ts
{
  type: "START_PLUS",
  unit: "DAYS" | "MONTHS",
  steps: number
}
```

```
100 VEST FROM
  LATER OF (
    DATE 2025-01-01,
    EVENT milestone2
  )
  OVER 4 years
  EVERY 1 year
```

| Amount | Date                                            | State      | Blockers           |
| :----- | :---------------------------------------------- | :--------- | :----------------- |
| 25     | `{ type: START_PLUS, unit: MONTHS, steps: 0 }`  | UNRESOLVED | `EVENT milestone2` |
| 25     | `{ type: START_PLUS, unit: MONTHS, steps: 12 }` | UNRESOLVED | `EVENT milestone2` |
| 25     | `{ type: START_PLUS, unit: MONTHS, steps: 24 }` | UNRESOLVED | `EVENT milestone2` |
| 25     | `{ type: START_PLUS, unit: MONTHS, steps: 36 }` | UNRESOLVED | `EVENT milestone2` |

### Maybe Before Cliff

```ts
{
  type: "MAYBE_BEFORE_CLIFF",
  date: OCTDate
}
```

```
100 VEST
  OVER 4 years
  EVERY 1 year
  CLIFF EVENT milestone
```

| Amount | Date                                             | State      | Blockers          |
| :----- | :----------------------------------------------- | :--------- | :---------------- |
| 25     | `{ type: MAYBE_BEFORE_CLIFF, date: 2026-01-01 }` | UNRESOLVED | `EVENT milestone` |
| 25     | `{ type: MAYBE_BEFORE_CLIFF, date: 2027-01-01 }` | UNRESOLVED | `EVENT milestone` |
| 25     | `{ type: MAYBE_BEFORE_CLIFF, date: 2028-01-01 }` | UNRESOLVED | `EVENT milestone` |
| 25     | `{ type: MAYBE_BEFORE_CLIFF, date: 2029-01-01 }` | UNRESOLVED | `EVENT milestone` |

## Impossible Installments

Impossible installments have the following shape:

```ts
{
  amount: number,
  meta: {
    state: "IMPOSSIBLE",
    blockers: string[]
  }
}
```

```
100 VEST FROM EVENT milestone before DATE 2025-01-01
```

| Amount | State      | Blockers                                 |
| :----- | :--------- | :--------------------------------------- |
| 100    | IMPOSSIBLE | `EVENT milestone BEFORE DATE 2025-01-01` |

---

## Special Cases

### Partial Knowledge for LATER OF selectors

In the case of a `LATER OF` selector, if some but not all items are resolved, we return the latest of the resolved items in order to avoid losing relevant information.

By way of example, consider a 4-year quarterly vesting schedule, with a cliff at the later of 12 months from the vesting start and a milestone event. The grant is made on 2025-01-01 over 100 shares

This vesting schedule is described with the following statement:

```
100 VEST OVER 4 years EVERY 3 months CLIFF LATER OF (12 months, EVENT milestone)
```

If `EVENT milestone` is not resolved, we can still indicate that a 12 month cliff will always apply:

| Amount | Symbolic Date                                  | State      | Blockers        |
| ------ | ---------------------------------------------- | ---------- | --------------- |
| 25     | `{type: MAYBE_BEFORE_CLIFF, date: 2026-01-01}` | UNRESOLVED | EVENT milestone |
| 6      | `{type: MAYBE_BEFORE_CLIFF, date: 2026-04-01}` | UNRESOLVED | EVENT milestone |
| 6      | `{type: MAYBE_BEFORE_CLIFF, date: 2026-07-01}` | UNRESOLVED | EVENT milestone |
| 6      | `{type: MAYBE_BEFORE_CLIFF, date: 2026-10-01}` | UNRESOLVED | EVENT milestone |
| 7      | `{type: MAYBE_BEFORE_CLIFF, date: 2027-01-01}` | UNRESOLVED | EVENT milestone |
| 6      | `{type: MAYBE_BEFORE_CLIFF, date: 2027-04-01}` | UNRESOLVED | EVENT milestone |
| 6      | `{type: MAYBE_BEFORE_CLIFF, date: 2027-07-01}` | UNRESOLVED | EVENT milestone |
| 6      | `{type: MAYBE_BEFORE_CLIFF, date: 2027-10-01}` | UNRESOLVED | EVENT milestone |
| 7      | `{type: MAYBE_BEFORE_CLIFF, date: 2028-01-01}` | UNRESOLVED | EVENT milestone |
| 6      | `{type: MAYBE_BEFORE_CLIFF, date: 2028-04-01}` | UNRESOLVED | EVENT milestone |
| 6      | `{type: MAYBE_BEFORE_CLIFF, date: 2028-07-01}` | UNRESOLVED | EVENT milestone |
| 6      | `{type: MAYBE_BEFORE_CLIFF, date: 2028-10-01}` | UNRESOLVED | EVENT milestone |
| 7      | `{type: MAYBE_BEFORE_CLIFF, date: 2029-01-01}` | UNRESOLVED | EVENT milestone |

### Vesting start before grant date

```
VEST FROM DATE 2024-01-01 OVER 4 years every 3 months
```
