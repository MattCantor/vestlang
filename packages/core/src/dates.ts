// Policy-aware, DST-safe date math over canonical ISO dates (YYYY-MM-DD).
//
// Ported from vestlang's evaluate/time.ts. Two adaptations for core:
//   - the day-of-month policy is passed directly as a VestingDayOfMonth value
//     (core has no EvaluationContext); it defaults to the canonical default,
//     VESTING_START_DAY_OR_LAST_DAY_OF_MONTH.
//   - comparisons are plain string comparisons. Zero-padded ISO dates sort
//     lexicographically, so this matches calendar order without pulling in
//     date-fns — core ships dependency-free.
//
// All stepping is done in UTC (dates built at UTC midnight, read back in UTC),
// so day arithmetic never drifts across DST transitions.

import type { OCFDate, PeriodType, VestingDayOfMonth } from "./types";

const DEFAULT_DAY_OF_MONTH: VestingDayOfMonth =
  "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH";

// ISO-string ↔ Date (UTC midnight)
export const toDate = (iso: OCFDate): Date => new Date(iso + "T00:00:00Z");
export const toISO = (d: Date): OCFDate => d.toISOString().slice(0, 10);

/**
 * Step `months` calendar months from `iso`, picking the target day-of-month per
 * the policy and clamping to the last day of shorter months (e.g. Jan 31 + 1mo
 * → Feb 28/29).
 */
export function addMonthsRule(
  iso: OCFDate,
  months: number,
  dayOfMonth: VestingDayOfMonth = DEFAULT_DAY_OF_MONTH,
): OCFDate {
  const d = toDate(iso);

  // Target (year, month) in UTC.
  const y0 = d.getUTCFullYear();
  const m0 = d.getUTCMonth();
  const mSum = m0 + months;
  const ty = y0 + Math.floor(mSum / 12);
  const tm = ((mSum % 12) + 12) % 12;

  // Last day of the target month in UTC: day 0 of the next month.
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();

  const pickDay = (): number => {
    switch (dayOfMonth) {
      case "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH":
        return Math.min(d.getUTCDate(), lastDay);
      case "29_OR_LAST_DAY_OF_MONTH":
        return Math.min(29, lastDay);
      case "30_OR_LAST_DAY_OF_MONTH":
        return Math.min(30, lastDay);
      case "31_OR_LAST_DAY_OF_MONTH":
        return Math.min(31, lastDay);
      default:
        // Fixed numeric day "01"–"28"; clamp to last day to avoid overflow.
        return Math.min(parseInt(dayOfMonth, 10), lastDay);
    }
  };

  return toISO(new Date(Date.UTC(ty, tm, pickDay())));
}

// Step `n` calendar days in UTC. `setUTCDate` rolls months/years correctly and
// is timezone-independent; a local-time stepper would drift a day across DST.
export const addDays = (iso: OCFDate, n: number): OCFDate => {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
};

/**
 * Step `units` of `periodType` from `start`. YEARS are months × 12 (so the same
 * day-of-month clamping applies). DAYS ignore the day-of-month policy.
 */
export const addPeriod = (
  start: OCFDate,
  units: number,
  periodType: PeriodType,
  dayOfMonth: VestingDayOfMonth = DEFAULT_DAY_OF_MONTH,
): OCFDate => {
  switch (periodType) {
    case "DAYS":
      return addDays(start, units);
    case "MONTHS":
      return addMonthsRule(start, units, dayOfMonth);
    case "YEARS":
      return addMonthsRule(start, units * 12, dayOfMonth);
  }
};

// Comparisons on ISO YYYY-MM-DD strings (lexicographic == calendar order).
export const lt = (a: OCFDate, b: OCFDate): boolean => a < b;
export const gt = (a: OCFDate, b: OCFDate): boolean => a > b;
export const eq = (a: OCFDate, b: OCFDate): boolean => a === b;
