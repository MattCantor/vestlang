---
title: DSL Grammar
sidebar_position: 1
---

The DSL describes a vesting **program** — one or more statements that compose. All keywords are case-insensitive.

## Programs

A program is one or more statements, composed two ways:

```
<program>  =  <chain> ( PLUS <chain> )*
<chain>    =  <statement> ( THEN <tail> )*
```

- **`THEN`** chains segments in sequence: a `THEN` segment has no start of its own (no `FROM`) — its vesting start is the previous segment's **final installment date**, and its cadence continues from there.
- **`PLUS`** runs components in parallel: two independent schedules on the same grant, each with its own `FROM`.

Chained — 25% over year 1, then the remaining 75% over years 2–4:

```vest
0.25 VEST OVER 12 months EVERY 1 month
  THEN 0.75 VEST OVER 36 months EVERY 1 month
```

Parallel — two independent grids on one grant:

```vest
0.5 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 12 months
  PLUS 0.5 VEST FROM DATE 2025-07-01 OVER 12 months EVERY 12 months
```

A whole program collapses to a single evaluated schedule — see [Evaluation](./evaluation.md).

## Statements

```
[ <amount> ] VEST <schedule-expr>
```

A `<schedule-expr>` is either a **singleton** or a **selector** over schedule-exprs.

### Singleton

A singleton encodes the ingredients of a vesting schedule: where it starts, how many installments, their cadence, and an optional cliff.

```
VEST
    [ FROM  <anchor> ]
    [ OVER  <duration> EVERY <duration> ]
    [ CLIFF <anchor> ]
```

- **`FROM`** sets the vesting start. Omitted → the grant date. (A `THEN` segment takes no `FROM`.)
- **`OVER … EVERY …`** sets the span and the cadence; the installment count is derived as `OVER ÷ EVERY`, which must divide evenly (a non-multiple is a parse error). The two appear together or not at all; omitting both means a single installment on the start date.
- **`CLIFF`** holds back every installment before the cliff and releases them as one lump when it lands.

### Selector

```
( EARLIER START OF | LATER START OF ) (
    <schedule-expr>,
    <schedule-expr>
    [, <schedule-expr> … ]
)
```

The selector compares the operand schedules by their **vesting start** and keeps the whole winning schedule — `EARLIER START OF` the one that starts first, `LATER START OF` the one that starts last; the losing schedule (its cadence, cliff, and amount) is dropped. `START` names that comparison key, distinguishing this schedule-level selector from the anchor-level `EARLIER OF` / `LATER OF` ([below](#selectors-over-anchors)) that chooses between bare anchors inside `FROM` / `CLIFF`.

## Anchors

A `FROM` start or a `CLIFF` is given by an **anchor** — a date, an event, or a selector over them, with optional offsets and a condition.

```
<anchor>  =  ( DATE <iso> | EVENT <name> | <system-ref> ) <offset>* [ <condition> ]
```

| Anchor | Form | Example |
| :-- | :-- | :-- |
| Date | `DATE YYYY-MM-DD` | `DATE 2025-01-01` |
| Event | `EVENT <name>` | `EVENT ipo` |
| System ref | `grantDate` / `vestingStart` (bareword or `EVENT`-prefixed) | `vestingStart + 12 months` |

Two system events are built in: **`grantDate`** (the grant date) and **`vestingStart`** (the resolved start, so a cliff can refer back to it). `vestingStart` can't be the *anchor* of a `FROM`, and `grantDate` can't be the *anchor* of a `CLIFF` (a bare `CLIFF <duration>` is measured from the resolved vesting start). Either may still appear *inside a condition* — e.g. a cliff gated `BEFORE EVENT grantDate + 84 months`.

### Offsets

An anchor may be shifted by one or more signed durations:

```vest
EVENT ipo + 6 months
DATE 2025-01-01 - 2 days
```

### Selectors over anchors

`EARLIER OF` / `LATER OF` choose between anchors. `EARLIER OF` selects the first to occur (acting like an OR); `LATER OF` requires all of them and selects the latest (an AND). The temporal naming keeps selectors distinct from conditions.

```vest
VEST FROM EARLIER OF ( DATE 2025-01-01, EVENT milestone )
```

## Conditions

A condition gates one anchor on another, and drives whether installments resolve, stay unresolved, or are impossible (see [Evaluation](./evaluation.md)).

```
[ STRICTLY ] ( BEFORE | AFTER ) ( DATE <iso> | EVENT <name> ) [ ( + | - ) <duration> ]
```

`STRICTLY` makes the comparison exclusive (`<` / `>`). Conditions combine with `AND` / `OR` — SQL precedence, so `AND` binds tighter and parentheses override — and also accept the function form `AND( … )` / `OR( … )`.

A bare mix of `AND` and `OR` at the same level (e.g. `a OR b AND c`) is still accepted, but it raises a `no-implicit-mixed-boolean` warning that spells out how the precedence grouped it — so the grouping is never silent. Parenthesize or use the function form to say it outright.

```vest
VEST FROM EVENT milestone
  STRICTLY BEFORE DATE 2025-01-01 AND AFTER EVENT threshold
```

## Duration

```
[ + | - ] <integer> ( day | days | week | weeks | month | months | year | years )
```

Weeks normalize to days and years to months in the AST. Within a single `OVER … EVERY`, both durations must share a base unit (months or days).

## Amount

An optional amount prefixes a statement, specifying how much of the grant it covers. Omitted → 100%.

```
0.5 VEST …      # a decimal in [0, 1] — a portion of the grant
1/2 VEST …      # a fraction — a portion of the grant
100 VEST …      # an integer — an absolute share count
```
