# Vestlang

> **A domain-specific language (DSL) for modeling vesting schedules**

Vestlang is a work-in-progress DSL designed to describe complex equity vesting schedules in a human-readable, composable format.

It provides two interopable representations:

- **Declarative Programs** - human- and machine-readable descriptions of vesting logic.
- **Imperative Vesting Installment Series** - normalized arrays of vesting installments with explicit triggers.

This dual design allows producers to emit simple arrrays of vesting dates and amounts, while advanced producers can describe arbitrary composite schedules that compile into those arrays.

---

## 🚀 Features (Planned)

- Human-friendly DSL for defining vesting logic
- TypeScript parser and compiler
- Schedule constructs
- Composite gates with `EARLIER OF` and `LATER OF`
- Compiler transforms DSL -> Program AST -> Event Series
- Schedule calculation engine (installments + gates)
- Prettier plugin for formatting
- CLI playground for rapid testing

---

## 📦 Packages

| Package                | Description                                      |
| ---------------------- | ------------------------------------------------ |
| `@vestlang/dsl`        | PEG grammar, parser, and AST definitions         |
| `@vestlang/engine`     | Evaluator that compiles Programs -> Event Series |
| `@vestlang/normalizer` | CNF canonicalizer + linter rules                 |
| `@vestlang/cli`        | CLI for running and testing DSL examples         |
| _(coming soon)_        | `@vestlang/prettier-plugin` — format support     |

---

## 🔹 Core Concepts

### Declarative Programs

A program describes **how vesting should work** using:

- **Schedule** (FROM, OVER, EVERY, CLIFF)
- **IF block** (events, dates, composites with `EARLIER OF` / `LATER OF`)

Every program normalizes to a **Canonical Normal Form (CNF)**:

```plaintext
AMOUNT VEST
  SCHEDULE FROM <anchor> OVER <duration> EVERY <period> [CLIFF <time-gate>]
  [IF <condition>]
```

### Imperative Vesting Installment Series

The canonical output for downstream systems is a **series of vesting installments**, each with:;

- `amount` - how much vests at this step
- `trigger` - a condition that resolves to a timestamp (`At`, `After`, `EarlierOf`, `LaterOf`)

Example:

```json
[
  { "amount": 25, "trigger": { "kind": "At", "data": "2026-01-01T00:00:00Z" } },
  {
    "amount": 2,
    "trigger": {
      "kind": "After",
      "duration": { "value": 1, "unit": "months" },
      "from": { "kind": "OneEvent", "eventRef": "Grant" }
    }
  }
]
```

---

## Semantics

### Accrual & Release

- **Accrual**: installments defined by `OVER`/`EVERY` from `FROM`.
- **Cliff**: time-based gate inside the schedule (`CLIFF 1 year`).
- **IF block**: event/date-based eligibity conditions.
- **Vesting gate**:

  ```plaintext
  T_gate = LATER OF (T_schedule_gate, T_if_gate)
  ```

- **Composite programs**: can be wrapped in `EARLIER OF` / `LATER OF` to model more complex vesting schedules

### Evaluation

- Programs compile -> Event Series.
- Event Series + context (known event dates) -> resolved vesting timeline.
- Consumers compute cumulative vested/unvested "on top" of the series

---

## Authoring Patters

### Pure Time Schedule

```plaintext
100 VEST
SCHEDULE FROM grantDate OVER 4 years EVERY 1 month
```

### Time Schedule + Time Cliff

```plaintext
100 VEST
SCHEDULE FROM grantDate OVER 4 years every 1 month CLIFF 1 year
```

### Two-Tier (time cliff AND event)

```plaintext
100 VEST
SCHEDULE FROM grantDate OVER 4 years EVERY 1 month CLIFF 1 year
IF ChangeInControl
```

-> vests at the _later of_ (grant + 1yr, CIC).

### Protective OR (earlier-of)

```plaintext
100 VEST IF EARLIER OF (ChangeInControl, AFTER 12 months)
```

-> vests at _earlier of_ CIC or grant+12m.

### Schedule Starting at Event

```plaintext
100 VEST
SCHEDULE FROM ChangeInControl OVER 4 years EVERY 1 month
```

### One-Shot on Event

```plaintext
100 VEST IF ChangeInControl
```

### One-Shot on Date

```plaintext
100 VEST IF AT 2026-01-01
```

---

## 🧱 Project Structure

```plaintext
vestlang/
├── packages/
│   └── dsl/            → parser and AST
│   └── engine/         → evaluator to event series
│   └── linter/         → linting
│   └── normalizer/     → canonicalization & linting
├── apps/
│   └── cli/            → CLI runner for DSL
├── tsconfig.base.json
├── turbo.json
└── README.md
```

---

## 🔧 Getting Started

```bash
git clone https://github.com/MattCantor/vestlang.git
cd vestlang
pnpm install
pnpm --filter @vestlang/cli build
node apps/cli/dist/index.js --help
```

---

## 🧑‍💻 Contributing

Early stage! If you're interested in vesting logic, compilers, or legal-tech DSLs — reach out or open an issue!
