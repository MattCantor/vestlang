import type { VestingDayOfMonth } from "@vestlang/types";
import { DEFAULT_VESTING_DAY_OF_MONTH } from "@vestlang/types";

// Inference preference order, DEFAULT (VESTING_START_DAY) first. The auto-search
// covers three policies and deliberately excludes VESTING_START_DAY_MINUS_ONE:
// for start days ≤ 28 it produces the identical stream to VESTING_START_DAY
// seeded a day earlier, so originating it from an ordinary schedule would just
// mislabel it. MINUS_ONE is distinct only for 29–31 starts, and recovering it
// from end-of-month streams is separate, deferred enhancement work. A caller-supplied
// MINUS_ONE hint IS threaded through and now projects correctly — the auto-search
// simply never originates it on its own.
export const POLICY_CANDIDATES: readonly VestingDayOfMonth[] = [
  DEFAULT_VESTING_DAY_OF_MONTH,
  "FIRST_DAY_OF_MONTH",
  "LAST_DAY_OF_MONTH",
];
