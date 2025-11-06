---
title: DSL Grammar
sidebar_position: 1
---

The DSL uses the following grammar. All keywords are case-insensitive.

```
[< amount > ] <schedule-expr>
```

### Schedule Expressions

A `<schedule-expr>` is either a singleton, or a selector over `<schedule-expr>`s.

#### Singleton `<schedule-expr>`

A singleton schedule encodes the fundamental ingredients of a vesting schedule, namely the vesting start, the number of installments, the cadence of installments, and an optional cliff.

```
VEST
    [ FROM <vesting-expr> [ OVER <duration> EVERY <duration> ] ]
    [ CLIFF <vesting-expr> ]
```

#### Selector over `schedule-expr`

```
( EARLIER OF | LATER OF ) (
    <schedule-expr>,
    <schedule-expr>
    [, <schedule-expr>...]
)
```

### Vesting Expressions

A `<vesting-expr>` is either a singleton, or a selector over `<vesting-expr`s:

#### Singleton `<vest-expr>`

A singleton `<vesting-expr>` is a date literal or an event, with one or more optional `<condition>`s.

```
( DATE <iso> | EVENT <string> ) [ <condition>... ]
```

| Node  | Pattern                                            |
| :---- | :------------------------------------------------- |
| Date  | `([0-9][0-9][0-9] "-" [0-1][0-9] "-" [0-3][0-9]) ` |
| Event | `([A-Za-z\_][A-Za-z0-9_]\*)`                       |

#### Selector over `<vest-expr>`

```
( EARLIER OF | LATER OF ) (
    <vesting-expr>,
    <vesting-expr>
    [, <vesting-expr>...]
)
```

### Conditions

A `<condition>` allows one vesting date/event to act as a gate for another, and are used by the [evaluator](./evaluation.md) to determine whether vesting installments are `resolved`, `unresolved`, or `impossible`.

Conditions are described as a `<duration>` which either precedes or follows a singleton `<vesting-expr>`.

```
[ ( BEFORE | AFTER )
( DATE <iso> | EVENT <string> ) [ ( + | - ) <duration> ] ]
```

`<condition>`s may be chained with `AND` and `OR` operators...

```

<condition> AND <condition> OR <condition>

```

...or grouped with parentheses.

```

(AND | OR) (
<condition>,
<condition>,
[, condition...]
)

```

### Duration

A duration is given by the following:

```

<number> (year|years|month|months|week|weeks|day|days)

```

### Amount

An `<amount>` may be provided with a decimal, indicating a portion between 0 and 1 inclusive...

```
.5 VEST
  OVER 48 months EVERY 1 months
```

...as a fraction, indicating a portion of the total quantity applicable to the security...

```vest
1/2 VEST
  OVER 48 months EVERY 1 months
```

...or as an interger, indicating an absolute number of shares.

```vest
100 VEST
  OVER 48 months EVERY 1 months
```
