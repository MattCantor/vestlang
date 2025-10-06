---
title: Grammar Layers
sidebar_position: 2
---

# Grammar Layers

Vestlang’s grammar is modular, defined across several `.peggy` files to maintain clarity and separation of concerns.

---

## Lexical Layer

Defines the fundamental tokens used by all other layers.

| Rule | Description |
|------|--------------|
| `_` | Optional whitespace |
| `AndSep` | `"AND"` separator |
| `CommaSep` | `","` separator |
| `Ident` | Alphanumeric identifier (event names) |
| `Strict` | The keyword `STRICTLY` |
| `Integer` / `Decimal` / `Number` | Numeric primitives |

See: [lexical.peggy](https://github.com/MattCantor/vestlang/blob/main/packages/dsl/src/grammar/10-lexical.peggy)

---

## Atoms

Atoms represent **bare time anchors**.

```vest
DATE 2025-12-31
EVENT IPO
```

| Rule | Example | AST |
|------|----------|-----|
| `DateAtom` | `DATE 2025-12-31` | `{ type: "Date", value: "2025-12-31" }` |
| `EventAtom` | `EVENT IPO` | `{ type: "Event", value: "IPO" }` |

See: [atoms.peggy](https://github.com/MattCantor/vestlang/blob/main/packages/dsl/src/grammar/20-atoms.peggy)

---

## Temporal Predicates

Attach predicates such as `BEFORE`, `AFTER`, or `BETWEEN` to an anchor.

Example:

```vest
EVENT IPO AFTER DATE 2024-12-31
```

AST:

```json
{
  "type": "Qualified",
  "base": { "type": "Event", "value": "IPO" },
  "predicates": [
    { "type": "After", "i": { "type": "Date", "value": "2024-12-31" }, "strict": false }
  ]
}
```

| Predicate | Example | AST Type |
|------------|----------|-----------|
| `BEFORE` | `BEFORE EVENT IPO` | `Before` |
| `AFTER` | `STRICTLY AFTER DATE 2025-01-01` | `After` |
| `BETWEEN` | `BETWEEN DATE 2024-01-01 AND EVENT CLOSE` | `Between` |

See: [temporal.peggy](https://github.com/MattCantor/vestlang/blob/main/packages/dsl/src/grammar/40-temporal.peggy)

---

## Durations

Handles quantities of time.

| Input | Normalized AST |
|--------|----------------|
| `12 months` | `{ type: "Duration", value: 12, unit: "MONTHS" }` |
| `2 years` | `{ type: "Duration", value: 24, unit: "MONTHS" }` |
| `3 weeks` | `{ type: "Duration", value: 21, unit: "DAYS" }` |


See: [durations.peggy](https://github.com/MattCantor/vestlang/blob/main/packages/dsl/src/grammar/30-duration.peggy)

---

## Schedule

The **core** of the DSL. Defines vesting schedules using `FROM`, `OVER`, `EVERY`, and `CLIFF`.

Example:

```vest
SCHEDULE FROM EVENT IPO OVER 4 YEARS EVERY 1 MONTH CLIFF 1 YEAR
```

AST:

```json
{
  "type": "Schedule",
  "from": { "type": "Event", "value": "IPO" },
  "over": { "type": "Duration", "value": 48, "unit": "MONTHS" },
  "every": { "type": "Duration", "value": 1, "unit": "MONTHS" },
  "cliff": { "type": "Duration", "value": 12, "unit": "MONTHS" }
}
```

Supports combinators:

```
FROM LATER OF (EVENT IPO, DATE 2025-01-01)
CLIFF EARLIER OF (DATE 2026-01-01, EVENT TERM)
```

See: [schedule.peggy](https://github.com/MattCantor/vestlang/blob/main/packages/dsl/src/grammar/50-schedule.peggy)

---

## Root Statement

Top-level entry point:

```vest
[amount] VEST <expression>
```

Examples:
```vest
VEST SCHEDULE OVER 4 YEARS EVERY 1 MONTH
0.5 VEST SCHEDULE FROM EVENT IPO OVER 2 YEARS EVERY 6 MONTHS
```

Default amount is `1.0` (100%) if omitted.

See: [root.peggy](https://github.com/MattCantor/vestlang/blob/main/packages/dsl/src/grammar/00-main.peggy)
