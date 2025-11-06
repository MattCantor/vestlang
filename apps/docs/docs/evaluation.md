---
title: Evaluation
sidebar_position: 3
---

Evaluation converts the AST into a sequence of vesting installments that are either **resolved** (with a concrete ISO date), **unresolved** (with a symbolic date and blockers), or **impossible** (with blockers).

The evaluator:

1. Attempts to resolve a **vesting start** date
2. Builds the periodic **dates** (or symbolic dates) for the vesting period
3. Treats the grant date as a "soft cliff" if any vesting installments precede the grant date (see below)
4. Applies any explicit **CLIFF** if present (including partial knowledge for `LATER OF` cliffs, see below)
5. **Allocates** the statement's amount across installments using the configured allocation mode
6. Emits vesting installments with metadata.

:::note
The shape and content of all metadata described below should be viewed as a bogey intended for discussion. All comments welcome!
:::

---

## Evaluation context

The following evaluation context is supplied the evaluator:

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

The grant date of the security (`events[grantDate]`) and the quantity of shares (`grantQuantity`) are required.

If the vesting start is resolved through the course of the evaluation, `EVENT vestingStart` is added to the `events` record.

### Vesting Day of Month

`vesting_day_of_month` tracks the OCT schema found [here](https://open-cap-table-coalition.github.io/Open-Cap-Format-OCF/schema_markdown/schema/types/vesting/VestingPeriodInMonths/), and defaults to `VESTING_START_DAY_OR_LAST_DAY_OF_MONTH`.

### Allocation Type

`allocation_type` tracks the OCT schema found [here](https://open-cap-table-coaltion.github.io/Open-Cap-Format-OCF/schema_markdown/schema/enums/AllocationType/), and defaults to `CUMULATIVE_ROUND_DOWN`.

### As Of Date

The `asOf` date is used to determine whether time-limited conditions have occured, and defaults to the current date if not provided.

For instance, consider a vesting schedule that starts if a milestone occurs before a given date in the future:

```vest
VEST FROM EVENT milestone BEFORE DATE 9999-01-01
```

If this statement is evaluated with an unresolved `EVENT milestone`, then vesting start will be unresolved. The returned tranche will be `UNRERESOLVED` rather than `IMPOSSIBLE` because the milestone event may occur in the future and the deadline has not yet elapsed.

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

#### DSL

```vest
100 VEST
  OVER 48 months EVERY 12 months
```

#### Vesting Installments

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

#### DSL

```vest
100 VEST FROM EVENT milestone
```

#### Vesting Installments

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

#### DSL

```vest
100 VEST FROM LATER OF(
  DATE 2025-01-01,
  EVENT milestone2
)
  OVER 48 months EVERY 12 months
```

#### Vesting Installments

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

#### DSL

```vest
100 VEST
  OVER 48 months EVERY 12 months
  CLIFF EVENT milestone
```

#### Vesting Installments

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

#### DSL

```vest
100 VEST FROM EVENT milestone BEFORE DATE 2025-01-01
```

#### Vesting Installments

| Amount | State      | Blockers                                 |
| :----- | :--------- | :--------------------------------------- |
| 100    | IMPOSSIBLE | `EVENT milestone BEFORE DATE 2025-01-01` |

---

## Special Cases

### Partial Knowledge for LATER OF selectors

In the case of a `LATER OF` selector, if some but not all items are resolved, we preserve the information gleaned from the resolved items.

By way of example, consider a 4-year quarterly vesting schedule, with a cliff at the later of 12 months from the vesting start and a milestone event. The grant is made on 2025-01-01 over 100 shares.

This vesting schedule is described with the following statement:

```vest
100 VEST
  OVER 48 months EVERY 3 months
  CLIFF LATER OF(
    +12 months,
    EVENT milestone
  )
```

If this statement is evaluated at a time when `EVENT milestone` is not resolved, the vesting start will be unresolved.

Nonetheless, since this is a `LATER OF` statement we know that a that a 12 month cliff will always apply:

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

Awards are often granted with a vesting start that precedes the grant date in order to provide vesting credit for services that have already been provided. In these situations the evaluator accrues vesting amounts until the grant date.

For instance, consider an award over 100 shares granted on 2025-01-01 with a 4-year quarterly vesting schedule commencing on 2024-01-01. All four vesting installments in calendar year 2024 are accrued and vest on the grant date.

```vest
100 VEST FROM DATE 2024-01-01
  OVER 48 months EVERY 3 months
```

| Amount | Date       | State    |
| :----- | :--------- | :------- |
| 25     | 2025-01-01 | RESOLVED |
| 6      | 2025-04-01 | RESOLVED |
| 6      | 2025-07-01 | RESOLVED |
| 6      | 2025-10-01 | RESOLVED |
| 7      | 2026-01-01 | RESOLVED |
| 6      | 2026-04-01 | RESOLVED |
| 6      | 2026-07-01 | RESOLVED |
| 6      | 2026-10-01 | RESOLVED |
| 7      | 2027-01-01 | RESOLVED |
| 6      | 2027-04-01 | RESOLVED |
| 6      | 2027-07-01 | RESOLVED |
| 6      | 2027-10-01 | RESOLVED |
| 7      | 2028-01-01 | RESOLVED |

## Blockers

The `blockers` included in the resolved and unresolved vesting installments above are partial vestlang DSL statemens, representing the portion of the statement that has not yet resolved.

Within the evaluator, this is done via interpretating the following internal blocker shapes. These blockers could be returned with each vesting installment directly, rather than the interpreted DSL string:

```ts
type UnresolvedBlocker =
  | {
      type: "EVENT_NOT_YET_OCCURRED";
      event: string;
    }
  | {
      type: "UNRESOLVED_SELECTOR";
      selector: "EARLIER_OF" | "LATER_OF";
      blockers: Blocker[];
    }
  | {
      type: "DATE_NOT_YET_OCCURRED";
      date: OCTDate;
    }
  | {
      type: "UNRESOLVED_CONDITION";
      condition: Omit<VestingNode, "type">;
    };

type ImpossibleBlocker =
  | {
      type: "IMPOSSIBLE_SELECTOR";
      selector: "EARLIER_OF" | "LATER_OF";
      blockers: ImpossibleBlocker[];
    }
  | {
      type: "IMPOSSIBLE_CONDITION";
      condition: Omit<VestingNode, "type">;
    };
```
