# vestlang

A domain-specific language for modeling vesting schedules.

## Installation

```bash
npm install vestlang
```

## Usage

```typescript
import { parse, normalizeProgram, evaluateStatement } from "vestlang";

const source = "VEST OVER 4 years EVERY 1 month CLIFF 1 year";
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

- `parse(source: string)` - Parse vestlang source into an AST

### Normalization

- `normalizeProgram(program)` - Normalize a parsed program for deterministic shape

### Evaluation

- `evaluateStatement(statement, context)` - Evaluate a single statement
- `evaluateProgram(program, context)` - Evaluate an entire program
- `evaluateStatementAsOf(statement, context)` - Evaluate a statement as of a specific date

### Linting

- `lintProgram(program, options?)` - Lint a normalized program
- `lintText(source, parser, options?)` - Lint source text

## Types

The package exports commonly used types:

- `Program` - A list of statements
- `Statement` - A single vesting statement
- `Schedule` - A vesting schedule
- `EvaluationContextInput` - Input context for evaluation
- `EvaluatedSchedule` - Result of evaluating a schedule
- `Installment` - A single vesting installment
- `Blocker` - A blocking condition preventing vesting

## License

MIT
