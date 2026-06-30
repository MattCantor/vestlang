import {
  addDays,
  addMonthsRule,
  addPeriod as addPeriodCore,
  daysBetween,
  monthsBetween,
} from "@vestlang/primitives";
import type { OCTDate, VestingDayOfMonth } from "@vestlang/types";

export type PeriodUnit = "days" | "weeks" | "months" | "years";

// The tool surface offers `weeks`, which core's PeriodType doesn't carry; map it
// to its day count and hand everything else straight to core's stepper. core
// takes the day-of-month policy directly, so there's no dummy context to build.
export function addPeriod(
  date: OCTDate,
  length: number,
  unit: PeriodUnit,
  rule: VestingDayOfMonth,
): OCTDate {
  switch (unit) {
    case "days":
      return addDays(date, length);
    case "weeks":
      return addDays(date, length * 7);
    case "months":
      return addPeriodCore(date, length, "MONTHS", rule);
    case "years":
      return addPeriodCore(date, length, "YEARS", rule);
  }
}

export function dateDiff(
  from: OCTDate,
  to: OCTDate,
  unit: "days" | "months",
): { diff: number; remainder_days?: number } {
  if (unit === "days") {
    return { diff: daysBetween(from, to) };
  }

  // The whole-month arithmetic (and its month-end clamp policy) lives in core,
  // as the inverse of core's month stepper. Here we just reshape core's
  // camelCase result into the tool's snake_case response.
  const { diff, remainderDays } = monthsBetween(from, to);
  return { diff, remainder_days: remainderDays };
}

/**
 * Resolve a date under a VestingDayOfMonth rule — equivalent to
 * `addMonthsRule(date, 0, rule)`, applying the rule's day-picker to the input's
 * year+month. For three of the four policies the result stays in that month.
 * VESTING_START_DAY_MINUS_ONE is the exception: it clamps the start-day
 * anniversary and then subtracts a calendar day, so a 1st-of-month input lands
 * on the prior month's last day (and a January 1st input on the prior year's
 * Dec 31).
 */
export function resolveVestingDay(
  date: OCTDate,
  rule: VestingDayOfMonth,
): OCTDate {
  return addMonthsRule(date, 0, rule);
}
