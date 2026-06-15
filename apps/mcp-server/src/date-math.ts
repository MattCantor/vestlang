import {
  addDays,
  addMonthsRule,
  addPeriod as addPeriodCore,
  daysBetween,
  toDate,
} from "@vestlang/core";
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

// Days in a given UTC (year, monthIdx), via day 0 of the next month. Built with
// setUTCFullYear (not Date.UTC) so years 0–99 stay verbatim rather than remapping
// to 1900–1999 — matching how core constructs its dates, so the leap-year answer
// is exact across the whole 0001–9999 range.
function daysInMonth(year: number, monthIdx: number): number {
  const d = new Date(0);
  d.setUTCFullYear(year, monthIdx + 1, 0);
  return d.getUTCDate();
}

export function dateDiff(
  from: OCTDate,
  to: OCTDate,
  unit: "days" | "months",
): { diff: number; remainder_days?: number } {
  if (unit === "days") {
    return { diff: daysBetween(from, to) };
  }

  // Calendar months between (fy, fm, fd) and (ty, tm, td).
  // The final month is complete once `to` reaches the day `add_period` would land
  // on after stepping that many whole months from `from`. That stepped day is
  // `from.day` clamped to the target month's length (addMonthsRule's month-end
  // clamp: Jan 31 + 1mo → Feb 28). Comparing against the raw `from.day` instead
  // would never credit a clamped endpoint as a full month, so e.g.
  // date_diff(Jan 31, Feb 28) would read 0 even though add_period(Jan 31, 1mo)
  // lands exactly on Feb 28. Compare against the clamped day in both directions.
  const f = toDate(from);
  const t = toDate(to);
  const fy = f.getUTCFullYear();
  const fm = f.getUTCMonth();
  const fd = f.getUTCDate();
  const ty = t.getUTCFullYear();
  const tm = t.getUTCMonth();
  const td = t.getUTCDate();

  const direction = t.getTime() >= f.getTime() ? 1 : -1;
  let monthsBetween = (ty - fy) * 12 + (tm - fm);
  if (direction === 1 && td < Math.min(fd, daysInMonth(ty, tm))) {
    monthsBetween -= 1;
  }
  if (direction === -1 && td > Math.min(fd, daysInMonth(fy, fm))) {
    monthsBetween += 1;
  }

  // Remainder days: from (from + monthsBetween months, clamped to end-of-month) to to.
  // Use the VESTING_START_DAY rule so the intermediate date keeps from's day when possible.
  const anchor = addMonthsRule(
    from,
    monthsBetween,
    "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
  );
  const remainder_days = daysBetween(anchor, to);

  return { diff: monthsBetween, remainder_days };
}

/**
 * Resolve a date under a VestingDayOfMonth rule, without crossing months.
 * Equivalent to `addMonthsRule(date, 0, rule)`: keeps year+month fixed and
 * applies the rule's day-picker for that month.
 */
export function resolveVestingDay(
  date: OCTDate,
  rule: VestingDayOfMonth,
): OCTDate {
  return addMonthsRule(date, 0, rule);
}
