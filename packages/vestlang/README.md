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
  grantDate: "2024-01-01",   // the grant-date anchor (its own field)
  events: {},                // named events the DSL references, e.g. { ipo: "2027-06-01" }
  grantQuantity: 10000,
  asOf: "2028-01-01",
});

console.log(schedule.interchange.status);      // storable:    "template" | "events-only" | "unrepresentable" | "impossible"
console.log(schedule.resolution.status);       // resolves-to: "template" | "events-only" | "unresolved" | "impossible"
console.log(schedule.resolution.installments); // [{ amount, date, meta: { state } }, ...]
console.log(schedule.absenceAssumptions);      // [{ eventId, through }, ...]
```

## How it works

Vestlang has two layers, split along one line — **resolve vs. substitute**:

- The **DSL front-end** (this package) _resolves_. It parses your statement, then resolves
  its combinators (`LATER OF` / `EARLIER OF`, event gates, conditional starts) against
  runtime — the grant date, share count, and which events have fired — and **classifies**
  the result into two verdicts: what's storable, and what it resolves to given known events.
- The **engine** (`@vestlang/core`) _substitutes_. Given a fully concrete, combinator-free
  template + runtime, it allocates exact integer shares — exact-rational math, a time-based
  cliff, structural validation. It never sees a combinator or an unresolved state.

The engine is re-exported as `core`:

```typescript
import { core } from "@vestlang/vestlang"; // or: import * as core from "@vestlang/core"
```

### Two verdicts

Every `EvaluatedSchedule` carries two classifications side by side:

| Verdict | Asks | `status` values |
| :-- | :-- | :-- |
| `interchange` | what a record keeper could **store** (computed without reading firings) | `template` / `events-only` / `unrepresentable` / `impossible` |
| `resolution` | what it **resolves to** given the events known | `template` / `events-only` / `unresolved` / `impossible` |

They can differ — a gated start is a storable `template` that may resolve to `impossible`
after an early firing. The schedule also carries `absenceAssumptions` (events the
resolves-to reading assumes stayed absent, each `{ eventId, through }`) and `findings`
(allocation problems). At the installment level, each row's `meta.state` is `RESOLVED`,
`UNRESOLVED`, or `IMPOSSIBLE`.

`evaluateStatement` classifies one statement at a time; `evaluateProgram` collapses a whole
multi-statement program into a **single** schedule.

## API

### Parsing

- `parse(source: string)` - Parse vestlang source into a raw AST

### Normalization

- `normalizeProgram(program)` - Normalize a parsed program into its canonical, deterministic shape

### Evaluation

- `evaluateStatement(statement, context)` - Resolve + classify a single statement into an `EvaluatedSchedule` (two verdicts + installments)
- `evaluateProgram(program, context)` - Collapse a whole multi-statement program into **one** schedule (returned as a one-element array)
- `evaluateStatementAsOf(statement, context)` - Evaluate a statement as of a specific date

### Inference (the inverse of evaluation)

- `inferSchedule(input)` - Reconstruct a vestlang program from observed `{ date, amount }` vesting tranches by branch-and-bound minimum-cardinality exact cover (a greedy seed sets the bound, then the search looks for a smaller cover). Returns `{ dsl, program, decomposition, diagnostics }`, where `diagnostics` reports the residual error and any fallbacks taken.

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
- `EvaluatedSchedule` - Result of evaluating a schedule (carries the two verdicts `interchange` / `resolution`, plus `installments`, `blockers`, `absenceAssumptions`, and `findings`)
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
