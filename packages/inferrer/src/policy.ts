import type { VestingDayOfMonth } from "@vestlang/types";
import { DEFAULT_VESTING_DAY_OF_MONTH } from "@vestlang/types";

// Inference preference order, DEFAULT (VESTING_START_DAY) first. Only the three
// policies the stepper can actually project are searched — VESTING_START_DAY_MINUS_ONE
// is excluded because its day math isn't implemented yet (#493), so the auto-search
// must never originate it. A caller-supplied MINUS_ONE hint is still threaded
// through; it just throws at projection time rather than being inferred here.
export const POLICY_CANDIDATES: readonly VestingDayOfMonth[] = [
  DEFAULT_VESTING_DAY_OF_MONTH,
  "FIRST_DAY_OF_MONTH",
  "LAST_DAY_OF_MONTH",
];
