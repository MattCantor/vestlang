# @nathamcrewott/vestlang

A domain-specific language for modeling vesting schedules.

## Installation

```bash
npm install @nathamcrewott/vestlang
```

Published to public npm — no registry configuration needed.

## Usage

```typescript
import { parse, normalizeProgram, evaluateStatement } from "@nathamcrewott/vestlang";

const source = "VEST FROM EVENT grant OVER 4 years EVERY 1 month CLIFF 1 year";
const program = normalizeProgram(parse(source));

const schedule = evaluateStatement(program[0], {
  events: { grantDate: "2024-01-01" },
  grantQuantity: 10000,
  asOf: "2028-01-01",
  allocation_type: "CUMULATIVE_ROUND_DOWN",
});

console.log(schedule.installments);
```

## API

### Parsing

- `parse(source: string)` - Parse vestlang source into a raw AST

### Normalization

- `normalizeProgram(program)` - Normalize a parsed program into its canonical, deterministic shape

### Evaluation

- `evaluateStatement(statement, context)` - Evaluate a single statement
- `evaluateProgram(program, context)` - Evaluate an entire program
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
- `EvaluatedSchedule` - Result of evaluating a schedule
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
