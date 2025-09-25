# Vestlang

> **A domain-specific language (DSL) for modeling vesting schedules**

Vestlang is a work-in-progress DSL designed to describe complex equity vesting schedules in a human-readable, composable format. It aims to be both expressive for lawyers and stock plan administrators and interpretable by software.

The language separates **time-based accrual mechanics** (the _Schedule_) from **eligibility conditions** (the _IF block_).

---

## 🚀 Features (Planned)

- Human-friendly DSL for defining vesting logic
- TypeScript parser and compiler
- Grant and schedule constructs
- Composite schedules with `and` logic (e.g. "later of")
- Compiler transforms DSL to structured AST
- Schedule calculation engine (installments)
- Prettier plugin for formatting
- CLI playground for rapid testing

---

## 📦 Packages

| Package                | Description                                  |
| ---------------------- | -------------------------------------------- |
| `@vestlang/core`       | PEG grammar, parser, and AST definitions     |
| `@vestlang/playground` | CLI for running and testing DSL examples     |
| _(coming soon)_        | `@vestlang/prettier-plugin` — format support |
| _(coming soon)_        | `@vestlang/cli` — user-friendly CLI tool     |

---

## 🧠 How Vestlang Works

At its core, Vestlang parses structured English into an abstract syntax tree (AST) representing **how and when equity grants vest**.

### 🔹 Core Concepts

| Concept    | Description                                            |
| ---------- | ------------------------------------------------------ |
| `amount`   | The first token is always a number (e.g. `100`)        |
| `schedule` | Defines how vesting occurs over time.                  |
| `IF block` | Defines _event- or date-based eligibility conditions_. |

#### Schedule

- FROM - the commencement date or event (default: `grantDate` if omitted).
- OVER - total duration of vesting (0 = single installment).
- EVERY - cadence of installments (0 if `OVER` is 0).
- CLIFF - a _time-based delay_ (duration from `FROM` or an absolute date).

#### IF Block

- Events (e.g., `ChangeInControl`)
- Dates (`2026-01-01`)
- Durations relative to commencement (`AFTER 1 year`)
- Composites:
  - `EARLIER OF ( ... )` - OR logic (first to occur opens the gate)
  - `LATER OF ( ... )` - AND logic (last to occur opens the gate)

#### Accrual vs Vesting vs Settlement

- Accrual: what has been "earned" under the schedule
- Vesting: what has been actually vested
- Settlement: implicit, not addressed in the DSL

### Canonical Normal Form (CNF)

Every vesting statement normalizes to:

```plaintext
AMOUNT VEST
  SCHEDULE FROM <anchor> OVER <duration> EVERY <period> [CLIFF <time-gate>]
  [IF <condition>]
```

- `anchor`: a date or event.
- `duration`: a total vesting window (0 allowed).
- `period`: installment cadence (0 if `OVER` is 0).
- `time-gate`: `0 days` (default), a duration, or a date.
- `condition`: an event/date condition, possibly composite.

---

## Semantics

### Commencement

`T_from` = resolved `FROM` (defaults to `grantDate`).

### Accrual

- If `OVER > 0`: accrual increases stepwise per period from `T_from` until the end of `OVER`.
- If `OVER = 0`: accrual is an instant 100% at T_from.

### Schedule Gate

`T_sched_gate = T_from + CLIFF` (or `T_from` if no CLIFF)

### IF Gate

`T_if_gate =` the time when the condition is satisfied.

- `AT <date>` = that date
- `<event>` = the event's occurrence
- `AFTER <duration` = `T_from + duration`
- `EARLIER OF` = min(child times)
- `LATER OF` = max(child times)

### Effective Release Gate

```plaintext
T_gate = LATER OF ( T_sched_gate, T_if_gate )
```

### Vested Function

```plaintext
Vested(t) = 0             if t < T_gate
Vested(t) = Accrued(t)    if t >= T_gate
```

---

## Authoring Patters

### Pure Time Schedule

100 VEST
SCHEDULE FROM grantDate OVER 4 years EVERY 1 month

### Time Schedule + Time Cliff

100 VEST
SCHEDULE FROM grantDate OVER 4 years every 1 month CLIFF 1 year

### Two-Tier (time cliff AND event)

100 VEST
SCHEDULE FROM grantDate OVER 4 years EVERY 1 month CLIFF 1 year
IF ChangeInControl

-> vests at the _later of_ (grant + 1yr, CIC).

### Protective OR (earlier-of)

100 VEST IF EARLIER OF (ChangeInControl, AFTER 12 months)

-> vests at _earlier of_ CIC or grant+12m.

### Schedule Starting at Event

100 VEST
SCHEDULE FROM ChangeInControl OVER 4 years EVERY 1 month

### One-Shot on Event

100 VEST IF ChangeInControl

### One-Shot on Date

100 VEST IF AT 2026-01-01

---

## EBNF (descriptive)

```bnf
LINE          := Amount "VEST" [SCHEDULE][IfBlock]
AMOUNT        := Number

SCHEDULE      := "SCHEDULE" From Over Every [Cliff]
FROM          := "FROM" (Date | Event)
OVER          := "OVER" Duration
Every         := "EVERY" Duration
CLIFF         := "CLIFF" ( "0 days" | Duration | Date )

IfBlock       := "IF" Condition

Condition     := Atom
                | "LATER OF" "(" ConditionList ")"
                | "EARLIER OF" "(" ConditionList ")"
ConditionList := Condition { "," Condition }

Atom =        := Event | "AT" Date | "AFTER" Duration
```

---

## Defaults & Guardrails

- If no `SCHEDULE` but `IF` exists -> inject `SCHEDULE FROM grantDate OVER 0 days every 0 days`.
- If `OVER 0` -> `EVERY` must be `0`.
- If multiple `CLIFF`s in SCHEDULE -> keep the latest (equivalent to max).
- If multiple top-level IFs -> normalize to `LATER OF`.
- Durations are always relative to `FROM`.
- If an event never occurs -> IF never satisified; nothing vests

---

## Style & Linting Guidelines

To keep authoring consistent:

### Time-only one-shots:

Preferred:
100 VEST
SCHEDULE FROM grantDate OVER 1 year EVERY 1 year

Allowed but discouraged:
100 VEST IF AFTER 1 year

#### Lint rule: if `IF AFTER <duration` is the only condition, suggest rewriting as the `SCHEDULE` form.

### Use `IF` for events or composites:

- Example: `IF ChangeInControl`
- Example: `IF EARLIER OF (ChangeInControl, AFTER 12 months )`

### Use `FROM` when the intent is to _start accrual_ (e.g., FROM ChangeInControl).

### Use `CLIFF` inside SCHEDULE for time-cliffs (the familiar 12-month cliff)

### USse `IF` for gates based on events/dates that block vesting

This rule of thumb eliminates ambiguity:

- Time belongs in SCHEDULE.
- Events/dates belong in IF.
- If an author mixes them, the linter can normalize to the canonical form.

---

## 🧱 Project Structure

```
vestlang/
├── packages/
│   └── core/         → parser and compiler
├── apps/
│   └── playground/   → CLI runner for DSL
├── tsconfig.base.json
├── turbo.json
└── README.md
```

---

## 🔧 Getting Started

```bash
git clone https://github.com/YOUR_ORG/vestlang.git
cd vestlang
npm install
npm run dev --workspace=@vestlang/playground
```

---

## 🧑‍💻 Contributing

Early stage! If you're interested in vesting logic, compilers, or legal-tech DSLs — reach out or open an issue!

---

## 📄 License

MIT

