// The day-of-month rule codes split into their two disjoint kinds. A fixed
// numeric day "01"–"28" picks that calendar day (clamped to month length, which
// never bites at ≤28); a named policy resolves the day at step time — 29/30/31
// fall back to month-end on short months, and VESTING_START tracks the grant's
// own vesting day. Keeping them as separate arrays lets `pickDay` narrow off the
// numeric branch and switch exhaustively over the four named policies, so a fifth
// named policy is a build break rather than a silent fall-through.
export const NUMERIC_DAY_OF_MONTH_VALUES = [
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "21",
  "22",
  "23",
  "24",
  "25",
  "26",
  "27",
  "28",
] as const;

export const NAMED_DAY_POLICY_VALUES = [
  "29_OR_LAST_DAY_OF_MONTH",
  "30_OR_LAST_DAY_OF_MONTH",
  "31_OR_LAST_DAY_OF_MONTH",
  "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
] as const;

// The full 32 codes, kept as a runtime array so consumers that need the values
// (e.g. the MCP server's Zod enum) can derive them rather than re-spelling the
// union by hand. Recomposed from the two component arrays in their original
// order — numeric first, then the named policies — so the value set and order at
// the entry points are unchanged.
export const VESTING_DAY_OF_MONTH_VALUES = [
  ...NUMERIC_DAY_OF_MONTH_VALUES,
  ...NAMED_DAY_POLICY_VALUES,
] as const;

type NumericDayOfMonth = (typeof NUMERIC_DAY_OF_MONTH_VALUES)[number];
export type NamedDayPolicy = (typeof NAMED_DAY_POLICY_VALUES)[number];

// `VestingDayOfMonth` is the union of the two sub-unions, so a dropped or renamed
// entry in either component array fails typecheck instead of silently narrowing.
export type VestingDayOfMonth = NumericDayOfMonth | NamedDayPolicy;

// Narrows a day-of-month code to its numeric branch. Membership is checked
// against the array widened to `readonly string[]`: `Array.prototype.includes` on
// `readonly NumericDayOfMonth[]` rejects the wider `VestingDayOfMonth` arg, and
// driving it off the array (rather than a `/^\d{2}$/` regex) keeps the predicate
// from drifting out of step with the values themselves.
export function isNumericDayOfMonth(
  v: VestingDayOfMonth,
): v is NumericDayOfMonth {
  return (NUMERIC_DAY_OF_MONTH_VALUES as readonly string[]).includes(v);
}

/**
 * The canonical day-of-month convention applied when a runtime carries no
 * vestingDayOfMonth. Single-sourced here because the same default is both
 * *omitted* from stored runtimes (evaluator) and *re-applied* on read-back
 * (core); the persistence round-trip is sound only while every consumer agrees
 * on this value, so they must all reference this one declaration.
 */
export const DEFAULT_VESTING_DAY_OF_MONTH: VestingDayOfMonth =
  "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH";
