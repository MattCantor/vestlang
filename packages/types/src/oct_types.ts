// The day-of-month policy: which calendar day in each month a monthly tranche
// lands on. Four named policies, no numeric days — `VESTING_START_DAY` tracks the
// grant's own vesting day (month-end-clamped on short months), `FIRST_DAY_OF_MONTH`
// and `LAST_DAY_OF_MONTH` pin to the month's edges, and `VESTING_START_DAY_MINUS_ONE`
// is the day before the start-day anchor. The set is OCF's v2 policy enum, adopted
// wholesale; `VestingDayOfMonth` is a thin re-export of it.
import type { OCFVestingDayOfMonthPolicy } from "@opencaptablecoalition/ocf-types";

export type VestingDayOfMonth = OCFVestingDayOfMonthPolicy;

// Runtime mirror of the union, in OCF declaration order, for consumers that need
// the values at runtime (the MCP server's Zod enum) rather than just the type.
// `satisfies readonly OCFVestingDayOfMonthPolicy[]` is the array⊆OCF half of the
// drift guard: a typo or an extra value fails to satisfy.
export const VESTING_DAY_OF_MONTH_VALUES = [
  "VESTING_START_DAY",
  "FIRST_DAY_OF_MONTH",
  "LAST_DAY_OF_MONTH",
  "VESTING_START_DAY_MINUS_ONE",
] as const satisfies readonly OCFVestingDayOfMonthPolicy[];

// The OCF⊆array half: every member of the vendored union must appear in the array.
// Together with the `satisfies` above this makes the array an exact match, so drift
// in either direction — a value dropped from the array, or one added to/renamed in
// the vendored OCF union — breaks `@vestlang/types` typecheck right here.
type ArrayCoversOCF =
  OCFVestingDayOfMonthPolicy extends (typeof VESTING_DAY_OF_MONTH_VALUES)[number]
    ? true
    : false;
const _coversOCF: ArrayCoversOCF = true;
void _coversOCF;

/**
 * The canonical day-of-month convention applied when a runtime carries no
 * vestingDayOfMonth. Single-sourced here because the same default is both
 * *omitted* from stored runtimes (evaluator) and *re-supplied* downstream (the
 * primitives stepper's parameter default, the evaluator context coalesce); the
 * persistence round-trip is sound only while every consumer agrees on this value,
 * so they must all reference this one declaration.
 */
export const DEFAULT_VESTING_DAY_OF_MONTH: VestingDayOfMonth =
  "VESTING_START_DAY";
