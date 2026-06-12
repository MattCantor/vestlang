---
title: Examples
sidebar_position: 2
---

Common vesting intents and the vestlang that expresses them. This is a pattern
reference, not the source of truth — [the grammar](./dsl_grammar.md) is authoritative for
syntax and constraints. When composing a new statement, validate it with `vestlang_lint`
(and `vestlang_parse`) before relying on it.

Keywords are case-insensitive; dates are `YYYY-MM-DD`.

## Time-based vesting

The whole grant over four years, monthly, with a one-year cliff — the classic shape:

```vest
VEST OVER 48 months EVERY 1 month CLIFF 12 months
```

The same span vesting quarterly instead of monthly:

```vest
VEST OVER 4 years EVERY 3 months CLIFF 1 year
```

Front-loaded: 25% across the first year, then the remaining 75% over the next three.
`THEN` continues from where the previous segment ended, so no `FROM` on the tail:

```vest
0.25 VEST OVER 12 months EVERY 1 month
  THEN 0.75 VEST OVER 36 months EVERY 1 month
```

## Choosing when vesting starts

`FROM` sets the start; omit it and vesting begins at the grant date.

A fixed calendar date:

```vest
VEST FROM DATE 2025-01-01 OVER 48 months EVERY 1 month CLIFF 12 months
```

A set time after the grant:

```vest
VEST FROM 6 months OVER 36 months EVERY 1 month
```

When a milestone fires — vesting stays pending until the `ipo` event occurs:

```vest
VEST FROM EVENT ipo OVER 24 months EVERY 1 month
```

The earlier of a fixed date or a milestone, whichever comes first:

```vest
VEST FROM EARLIER OF (DATE 2026-01-01, EVENT ipo) OVER 48 months EVERY 1 month
```

The later of two conditions — both must occur, and vesting starts at the second:

```vest
VEST FROM LATER OF (EVENT board, DATE 2025-01-01) OVER 48 months EVERY 1 month
```

Whichever whole schedule starts first wins — operands are bare schedules, no `VEST` inside the parentheses:

```vest
VEST EARLIER START OF (FROM EVENT ipo OVER 12 months EVERY 1 month, FROM DATE 2027-01-01 OVER 12 months EVERY 1 month)
```

A milestone honored only inside a window (a proviso on the start, not a date cap):

```vest
VEST FROM EVENT board AFTER DATE 2025-01-01 AND BEFORE DATE 2025-12-31 OVER 48 months EVERY 1 month
```

## Cliffs and parallel schedules

Accrue monthly but release nothing until a liquidity event — a single-trigger hold. A
cliff gated on an event has no fixed date, so it resolves to **events-only** rather than a
single template — and since the canonical cliff is a fixed duration, there's nowhere to
store an event-anchored one, so the storable verdict is **unrepresentable**. The same
construct, seen through the two lenses (see [the two verdicts](./evaluation.md#the-two-verdicts)):

```vest
VEST OVER 48 months EVERY 1 month CLIFF EVENT ipo
```

Two independent schedules on one grant, run in parallel with `PLUS`. Overlapping absolute
starts classify **events-only** — but when their projection has a single-template form the
default program surfaces **recover** them to a template (see [Template
recovery](./evaluation.md#template-recovery)):

```vest
0.5 VEST FROM DATE 2024-01-01 OVER 24 months EVERY 1 month
  PLUS 0.5 VEST FROM DATE 2025-01-01 OVER 24 months EVERY 1 month
```
