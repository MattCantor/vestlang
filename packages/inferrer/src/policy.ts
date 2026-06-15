import type { VestingDayOfMonth } from "@vestlang/types";
import {
  DEFAULT_VESTING_DAY_OF_MONTH,
  NUMERIC_DAY_OF_MONTH_VALUES,
} from "@vestlang/types";

// Inference preference order, DEFAULT first — not the canonical order, so the
// named policies stay hand-listed rather than spread from NAMED_DAY_POLICY_VALUES.
// The numeric "01"–"28" come straight off the canonical array, which retires the
// old padStart-and-cast loop.
export const POLICY_CANDIDATES: readonly VestingDayOfMonth[] = [
  DEFAULT_VESTING_DAY_OF_MONTH,
  "29_OR_LAST_DAY_OF_MONTH",
  "30_OR_LAST_DAY_OF_MONTH",
  "31_OR_LAST_DAY_OF_MONTH",
  ...NUMERIC_DAY_OF_MONTH_VALUES,
];
