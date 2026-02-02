# Simple Vesting Specification

A simplified vesting AST for time-based vesting with cliff support.

## Background

### Why Vesting Is Different

Vesting is meaningfully different from other parts of a cap table schema. Most schema elements are pure data shapes. You can define a JSON structure and platforms can serve and ingest it directly. Vesting, however, is effectively **spec + compiler + projection**:

- The **spec** expresses the inputs (schedule parameters)
- The **compiler** evaluates those inputs
- The **projection** is the resulting stream of vesting events (date + amount pairs)

Every platform in the ecosystem has its own proprietary vesting spec tightly coupled to its own proprietary compiler. OCT has gestured at a vesting spec based on a DAG, but without ever standardizing a compiler or seeing real adoption.

We are not anticipating open sourcing a standardized compiler or reference implementation at this stage of the process, although that remains a long-term objective.

This makes vesting the one area where perfect schema alignment may be unrealistic at this stage, and adapters may be unavoidable if OCF wants a clean, reusable, ecosystem-friendly model.

### Design Goals

This spec intentionally targets simple time-based vesting with a cliff, rather than trying to model every possible vesting arrangement. The goal is:

1. **Simplicity**: Easy to implement, easy to understand
2. **Coverage**: Handles vanilla equity grant schedules
3. **Interoperability**: A baseline that any platform can serve and ingest without complex adapters
4. **Extensibility**: Doesn't preclude future additions for more complex scenarios

For complex vesting arrangements (milestone-based, conditional, etc.), platforms can either extend this spec or fall back to proprietary representations with adapters.

## Scope

### Included

- Concrete vesting commencement dates
- Number of vesting occurrences
- Vesting period (e.g., monthly, daily)
- Optional cliff
- Quantity or fractional amounts
- Multi-tranche programs

### Excluded

| Feature                           | Why Excluded                             |
| --------------------------------- | ---------------------------------------- |
| `EVENT` base type                 | No milestone/event-driven vesting        |
| `BEFORE`/`AFTER` constraints      | No temporal conditions                   |
| `AND`/`OR` conditions             | No boolean logic                         |
| `EARLIER_OF`/`LATER_OF` selectors | No dynamic date selection                |
| Event-based cliffs                | Cliff is duration-only                   |
| Unresolved/Impossible states      | All dates resolve immediately            |
| Acceleration clauses              | Future extension (single/double trigger) |

## TypeScript Types

```typescript
/* ------------------------
 * Duration
 * ------------------------ */

type PeriodUnit = "DAYS" | "MONTHS";

interface Duration {
  value: number;
  unit: PeriodUnit;
}

/* ------------------------
 * Amount
 * ------------------------ */

interface QuantityAmount {
  type: "QUANTITY";
  value: number;
}

interface FractionAmount {
  type: "FRACTION";
  numerator: number;
  denominator: number;
}

type Amount = QuantityAmount | FractionAmount;

/* ------------------------
 * Vesting Schedule
 * ------------------------ */

type AllocationMethod =
  | "CUMULATIVE_ROUNDING"
  | "CUMULATIVE_ROUND_DOWN"
  | "FRONT_LOADED"
  | "BACK_LOADED"
  | "FRONT_LOADED_TO_SINGLE_TRANCHE"
  | "BACK_LOADED_TO_SINGLE_TRANCHE"
  | "FRACTIONAL";

interface VestingSchedule {
  /** The date vesting begins */
  vestingStartDate: string; // ISO 8601 date (YYYY-MM-DD)

  /** Number of vesting installments */
  occurrences: number;

  /** Time between each vesting event */
  period: Duration;

  /** Optional cliff - no vesting until cliff is reached */
  cliff?: Duration;

  /** How to allocate fractional amounts across installments (default: CUMULATIVE_ROUND_DOWN) */
  allocationMethod?: AllocationMethod;
}

/* ------------------------
 * Vesting Statement
 * ------------------------ */

interface VestingStatement {
  /** Total amount being vested */
  amount: Amount;

  /** The vesting schedule */
  schedule: VestingSchedule;
}

/** A program can have multiple tranches */
type VestingProgram = VestingStatement[];
```

## Examples

### Standard 4-Year Vesting with 1-Year Cliff

```typescript
const grant: VestingStatement = {
  amount: { type: "QUANTITY", value: 10000 },
  schedule: {
    vestingStartDate: "2025-01-01",
    occurrences: 48,
    period: { value: 1, unit: "MONTHS" },
    cliff: { value: 12, unit: "MONTHS" },
  },
};
```

**Result**: 10,000 shares vest over 4 years with monthly vesting. No shares vest until the 1-year cliff (2026-01-01), at which point 25% (2,500 shares) vest immediately, then ~208 shares vest monthly thereafter.

### Quarterly Vesting (No Cliff)

```typescript
const grant: VestingStatement = {
  amount: { type: "FRACTION", numerator: 1, denominator: 1 },
  schedule: {
    vestingStartDate: "2025-01-01",
    occurrences: 8,
    period: { value: 3, unit: "MONTHS" },
  },
};
```

**Result**: The full amount vests over 2 years in quarterly installments (8 tranches).

### Two-Tranche: Immediate + Time-Based

```typescript
const program: VestingProgram = [
  {
    amount: { type: "FRACTION", numerator: 1, denominator: 4 },
    schedule: {
      vestingStartDate: "2025-01-01",
      occurrences: 1,
      period: { value: 0, unit: "DAYS" },
    },
  },
  {
    amount: { type: "FRACTION", numerator: 3, denominator: 4 },
    schedule: {
      vestingStartDate: "2025-01-01",
      occurrences: 36,
      period: { value: 1, unit: "MONTHS" },
      cliff: { value: 12, unit: "MONTHS" },
    },
  },
];
```

**Result**: 1/4 vests immediately on grant. Remaining 3/4 vests over 3 years with a 1-year cliff and monthly vesting.

### Advisor Grant (2-Year Monthly)

```typescript
const grant: VestingStatement = {
  amount: { type: "QUANTITY", value: 5000 },
  schedule: {
    vestingStartDate: "2025-06-15",
    occurrences: 24,
    period: { value: 1, unit: "MONTHS" },
    cliff: { value: 3, unit: "MONTHS" },
  },
};
```

**Result**: 5,000 shares vest over 2 years with monthly vesting and a 3-month cliff.

## Open Questions

### Occurrences vs. Duration

The spec defines a vesting schedule using **occurrences + period**, from which total duration is derived:

```typescript
{
  occurrences: 48,
  period: { value: 1, unit: "MONTHS" },
}
// Implies: 48 months total duration
```

An alternative approach would be **duration + period**, from which occurrences is derived:

```typescript
{
  totalDuration: { value: 48, unit: "MONTHS" },
  period: { value: 1, unit: "MONTHS" },
}
// Implies: 48 occurrences
```

Both representations are equivalent for regular schedules. The question is which feels more natural to implementers and maps better to how platforms already model vesting internally.

**Feedback requested**: Which approach better aligns with your existing data model?

### Immediate Vesting

Immediate (day-one) vesting is encoded as a single occurrence:

```typescript
{
  vestingStartDate: "2025-01-01",
  occurrences: 1,
  period: { value: 0, unit: "DAYS" },
}
```

This avoids adding a redundant `immediate` flag.

**Feedback requested**: Does this approach work for your platform?

### Allocation Methods

The spec includes multiple allocation methods for distributing fractional amounts across installments:

| Method | Example: 18 units across 4 tranches |
| ------ | ----------------------------------- |
| `CUMULATIVE_ROUND_DOWN` (default) | 4 - 5 - 4 - 5 |
| `CUMULATIVE_ROUNDING` | 5 - 4 - 5 - 4 |
| `FRONT_LOADED` | 5 - 5 - 4 - 4 |
| `BACK_LOADED` | 4 - 4 - 5 - 5 |
| `FRONT_LOADED_TO_SINGLE_TRANCHE` | 6 - 4 - 4 - 4 |
| `BACK_LOADED_TO_SINGLE_TRANCHE` | 4 - 4 - 4 - 6 |
| `FRACTIONAL` | 4.5 - 4.5 - 4.5 - 4.5 |

**Feedback requested**: Which of these methods does your platform support?

### Fraction Representation

Using a fixed decimal (e.g., 0-100) restricts percentages to fractions with denominator 100. This loses precision for values like 1/3.

The spec uses explicit fractions to avoid floating-point precision issues:

```typescript
{ type: "FRACTION", numerator: 1, denominator: 3 } // exactly 1/3
{ type: "FRACTION", numerator: 1, denominator: 4 } // exactly 25%
```
