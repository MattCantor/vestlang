// The 32 day-of-month rule codes, kept as a runtime array so consumers that need
// the values (e.g. the MCP server's Zod enum) can derive them rather than
// re-spelling the union by hand. `VestingDayOfMonth` is derived from it, so a
// dropped or renamed entry fails typecheck instead of silently narrowing.
export const VESTING_DAY_OF_MONTH_VALUES = [
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
  "29_OR_LAST_DAY_OF_MONTH",
  "30_OR_LAST_DAY_OF_MONTH",
  "31_OR_LAST_DAY_OF_MONTH",
  "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
] as const;

export type VestingDayOfMonth = (typeof VESTING_DAY_OF_MONTH_VALUES)[number];

/**
 * The canonical day-of-month convention applied when a runtime carries no
 * vestingDayOfMonth. Single-sourced here because the same default is both
 * *omitted* from stored runtimes (evaluator) and *re-applied* on read-back
 * (core); the persistence round-trip is sound only while every consumer agrees
 * on this value, so they must all reference this one declaration.
 */
export const DEFAULT_VESTING_DAY_OF_MONTH: VestingDayOfMonth =
  "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH";
