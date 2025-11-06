---
title: DSL Grammar
sidebar_position: 1
---

The DSL uses the following grammar. All keywords are case-insensitive.

```
[ <amount> ] VEST
    [ FROM <vesting-expr> [ OVER <duration> EVERY <duration> ] ]
    [ CLIFF <vesting-expr> ]
```

### Vesting Expressions

A `<vesting-expr>` is either a singleton (described below), or a selector over `<vesting-expr`s:

```
( EARLIER OF | LATER OF ) (
    <vesting-expr>,
    <vesting-expr>
    [, <vesting-expr>...]
)
```

A singleton `<vesting-expr>` is a date literal or an event, with one or more optional `<condition>`s.

```
( DATE <iso> | EVENT <string> ) [ <condition> ]
```

| Node  | Pattern                                            |
| :---- | :------------------------------------------------- |
| Date  | `([0-9][0-9][0-9] "-" [0-1][0-9] "-" [0-3][0-9]) ` |
| Event | `([A-Za-z\_][A-Za-z0-9_]\*)`                       |

### Conditions

A `<condition>` describes a `<duration>` preceding or following a singleton `<vesting-expr>`, as follows:

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

```vest
1/2 VEST
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
