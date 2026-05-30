# @vestlang/vestlang

A domain-specific language for modeling vesting schedules.

## Installation

```bash
npm install @vestlang/vestlang
```

## Usage

```typescript
import { parse, normalizeProgram, evaluateStatement } from "@vestlang/vestlang";

const source = "VEST OVER 4 years EVERY 1 month CLIFF 1 year";
const program = normalizeProgram(parse(source));

const schedule = evaluateStatement(program[0], {
  events: { grantDate: "2024-01-01" },
  grantQuantity: 10000,
  asOf: "2028-01-01",
  allocation_type: "CUMULATIVE_ROUND_DOWN",
});

console.log(schedule.fidelity);     // "template" | "events-only" | "unresolved"
console.log(schedule.installments); // [{ amount, date, meta: { state } }, ...]
console.log(schedule.blockers);     // [] unless something is unresolved
```

## How it works

Vestlang has two layers, split along one line — **resolve vs. substitute**:

- The **DSL front-end** (this package) _resolves_. It parses your statement, then resolves
  its combinators (`LATER OF` / `EARLIER OF`, event gates, conditional starts) against
  runtime — the grant date, share count, and which events have fired — and **classifies**
  the result by how well it fits the canonical interchange.
- The **engine** (`@vestlang/core`) _substitutes_. Given a fully concrete, combinator-free
  template + runtime, it allocates exact integer shares — exact-rational math, a time-based
  cliff, structural validation. It never sees a combinator or an unresolved state.

The engine is re-exported as `core`:

```typescript
import { core } from "@vestlang/vestlang"; // or: import * as core from "@vestlang/core"
```

### The fidelity verdict

Every `EvaluatedSchedule` carries a `fidelity` tag describing how the program mapped onto
the interchange:

| `fidelity` | Meaning |
| :--------- | :------ |
| `"template"` | Resolved and fit one canonical template — exact installments, intent preserved (best case). |
| `"events-only"` | Resolved to concrete dated amounts but couldn't be one template (overlapping independent starts, a loaded allocation mode, an event-anchored cliff). Carries a `reason`; facts preserved, intent reported honestly. |
| `"unresolved"` | Can't be materialized yet — an unfired event or a contradictory condition. Installments carry symbolic/absent dates and `blockers` name what's missing. |

At the installment level, each row's `meta.state` is `RESOLVED`, `UNRESOLVED`, or `IMPOSSIBLE`.

`evaluateStatement` classifies one statement at a time; `evaluateProgram` collapses a whole
multi-statement program into a **single** schedule and reports its program-level verdict.

## API

### Parsing

- `parse(source: string)` - Parse vestlang source into a raw AST

### Normalization

- `normalizeProgram(program)` - Normalize a parsed program into its canonical, deterministic shape

### Evaluation

- `evaluateStatement(statement, context)` - Resolve + classify a single statement into a fidelity-tagged `EvaluatedSchedule`
- `evaluateProgram(program, context)` - Collapse a whole multi-statement program into **one** fidelity-tagged schedule (returned as a one-element array)
- `evaluateStatementAsOf(statement, context)` - Evaluate a statement as of a specific date

### Inference (the inverse of evaluation)

- `inferSchedule(input)` - Reconstruct a vestlang program from observed `{ date, amount }` vesting tranches via matching-pursuit decomposition. Returns `{ dsl, program, decomposition, diagnostics }`, where `diagnostics` reports the residual error and any fallbacks taken.

### Stringify

- `stringify(node)` - Render an AST node back to vestlang DSL source
- `stringifyProgram(program)` - Render a whole program to DSL source
- `stringifyStatement(statement)` - Render a single statement to DSL source

### Linting

- `lintProgram(program, options?)` - Lint a normalized program
- `lintText(source, parser, options?)` - Lint source text

## Types

The package exports commonly used types:

**Programs & statements**

- `Program` - A normalized list of statements
- `RawProgram` - A parsed-but-not-yet-normalized program (the output of `parse`)
- `Statement` - A single vesting statement
- `Schedule` - A vesting schedule

**Evaluation**

- `EvaluationContextInput` - Input context for evaluation
- `EvaluatedSchedule` - Result of evaluating a schedule (carries `installments`, `blockers`, and the `fidelity` tag + optional `reason`)
- `Installment` - A single vesting installment
- `ResolvedInstallment` / `UnresolvedInstallment` / `ImpossibleInstallment` - The installment states
- `VestedResult` - Vested/unvested quantities produced by evaluation
- `Blocker` - A blocking condition preventing vesting
- `OCTDate` - An ISO `YYYY-MM-DD` date string

**Linting**

- `Diagnostic` - A single lint finding
- `LintResult` - The result of a lint run
- `LintOptions` - Lint configuration

**Inference**

- `InferInput` - Input to `inferSchedule` (`tranches`, plus optional `grantDate` / policy hints)
- `InferResult` - Output of `inferSchedule` (`dsl`, `program`, `decomposition`, `diagnostics`)
- `TrancheInput` - A single observed `{ date, amount }` tranche
- `Component` - A decomposition component: `UniformComponent` | `SingleTrancheComponent` | `CliffUniformComponent`

## License

MIT
