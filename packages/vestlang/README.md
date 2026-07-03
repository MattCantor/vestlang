# @vestlang/vestlang

A domain-specific language for modeling vesting schedules.

## Installation

```bash
npm install @vestlang/vestlang
```

## Usage

```typescript
import {
  parse,
  normalizeProgram,
  evaluateProgramWithRecovery,
} from "@vestlang/vestlang";

const source = "VEST OVER 4 years EVERY 1 month CLIFF 1 year";
const program = normalizeProgram(parse(source));

// Evaluates the whole program as one grant. `outcome.schedule` is the evaluated
// schedule; `outcome.rescued` is true when an events-only program was recovered
// back to a template (and `outcome.recovered` then describes the recovery).
const outcome = evaluateProgramWithRecovery(program, {
  grantDate: "2024-01-01",   // the grant-date anchor (its own field)
  events: {},                // named events the DSL references, e.g. { ipo: "2027-06-01" }
  grantQuantity: 10000,
  asOf: "2028-01-01",
});
const schedule = outcome.schedule;

console.log(schedule.storable.status);      // storable:    "template" | "events-only" | "unrepresentable" | "impossible"
console.log(schedule.resolvesTo.status);       // resolves-to: "template" | "events-only" | "unresolved" | "impossible"
console.log(schedule.resolvesTo.installments); // [{ amount, date, meta: { state } }, ...]
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
| `storable` | what a record keeper could **store** (computed without reading firings) | `template` / `events-only` / `unrepresentable` / `impossible` |
| `resolvesTo` | what it **resolves to** given the events known | `template` / `events-only` / `unresolved` / `impossible` |

They can differ — a gated start is a storable `template` that may resolve to `impossible`
after an early firing. The schedule also carries `absenceAssumptions` (events the
resolves-to reading assumes stayed absent, each `{ eventId, through }`) and `findings`
(allocation problems). At the installment level, each row's `meta.state` is `RESOLVED`,
`UNRESOLVED`, or `IMPOSSIBLE`.

`evaluateProgramWithRecovery` collapses a whole program — one statement or many — into a
**single** schedule, and recovers an events-only result back to a template when its projection
turns out to have one.

## API

### Parsing

- `parse(source: string)` - Parse vestlang source into a raw AST

### Normalization

- `normalizeProgram(program)` - Normalize a parsed program into its canonical, deterministic shape

### Evaluation

- `evaluateProgramWithRecovery(program, context)` - Collapse a whole program into **one** `EvaluatedSchedule` (two verdicts + installments), recovering an events-only result back to a template when its projection has one. Returns a `RecoveryOutcome` whose `.schedule` is the evaluated schedule.

### Inference (the inverse of evaluation)

- `inferSchedule(input)` - Reconstruct a vestlang program from observed `{ date, amount }` vesting tranches by analytic hypothesize-and-verify: candidate templates are derived in closed form from the stream's date lattice and cumulative sums, each is verified by evaluating it back through the real engine, and the first that reproduces the stream in a fixed preference order wins (anything unrecognized falls back to a literal per-date list). Returns `{ dsl, program, decomposition, diagnostics }`, where `decomposition` tags each emitted statement by the family that recovered it and `diagnostics` reports the residual error and whether the literal fallback fired.

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
- `EvaluatedSchedule` - Result of evaluating a schedule (carries the two verdicts `storable` / `resolvesTo`, plus `installments`, `blockers`, `absenceAssumptions`, and `findings`)
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
