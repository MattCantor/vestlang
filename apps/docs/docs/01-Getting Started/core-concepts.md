---
title: Core Concepts
sidebar_position: 3
---
## Declarative Statements

A **statement** has this shape:

```text
[Amount]? VEST <Expression>
```

where `<Expression` is typically a `SCHEDULE` with the following *schedule elements*:

### FROM
The vesting start **anchor** (a date, event, qualified anchor, or a combinator like `EARLIER OF` / `LATER OF`).

:::note
If omitted, the parser leaves it `null`.  The **normalizer** will supply a default (`EVENT grantDate`).
:::

### OVER
Total duration of the schedule.

### EVERY
Installmant cadence.

:::warning
`OVER` and `EVERY` must appear *together* if either is supplied.
:::

### CLIFF
An additional delay or gate before vesting can start.
Can be a **duration**, **anchor**, **qualified anchor**, or **combinator**.

:::tip
Keywords are case-insensitive.  The grammar accepts lower/mixed case inputs too.
:::

## Amounts
#### Integer -> absolute shares (e.g., 123).
#### Decimal in [0,1] -> percent of total (e.g., `.5` for 50%).
#### Default -> `1.0` (100%) if omitted.
