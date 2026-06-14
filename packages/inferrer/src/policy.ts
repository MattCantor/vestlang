import type { VestingDayOfMonth } from "@vestlang/types";
import { DEFAULT_VESTING_DAY_OF_MONTH } from "@vestlang/types";

function numericDays(): VestingDayOfMonth[] {
  const out: VestingDayOfMonth[] = [];
  for (let i = 1; i <= 28; i++) {
    out.push(String(i).padStart(2, "0") as VestingDayOfMonth);
  }
  return out;
}

export const POLICY_CANDIDATES: readonly VestingDayOfMonth[] = [
  DEFAULT_VESTING_DAY_OF_MONTH,
  "29_OR_LAST_DAY_OF_MONTH",
  "30_OR_LAST_DAY_OF_MONTH",
  "31_OR_LAST_DAY_OF_MONTH",
  ...numericDays(),
];
