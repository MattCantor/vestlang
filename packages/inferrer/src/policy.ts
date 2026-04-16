import type {
  allocation_type,
  vesting_day_of_month,
} from "@vestlang/types";

function numericDays(): vesting_day_of_month[] {
  const out: vesting_day_of_month[] = [];
  for (let i = 1; i <= 28; i++) {
    out.push(String(i).padStart(2, "0") as vesting_day_of_month);
  }
  return out;
}

export const POLICY_CANDIDATES: readonly vesting_day_of_month[] = [
  "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
  "29_OR_LAST_DAY_OF_MONTH",
  "30_OR_LAST_DAY_OF_MONTH",
  "31_OR_LAST_DAY_OF_MONTH",
  ...numericDays(),
];

export const ALLOCATION_CANDIDATES: readonly allocation_type[] = [
  "CUMULATIVE_ROUNDING",
  "CUMULATIVE_ROUND_DOWN",
  "FRONT_LOADED",
  "BACK_LOADED",
  "FRONT_LOADED_TO_SINGLE_TRANCHE",
  "BACK_LOADED_TO_SINGLE_TRANCHE",
];
