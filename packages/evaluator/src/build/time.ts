import { EvaluationContext, OCTDate, PeriodTag } from "@vestlang/types";
import { addDays as dfAddDays, isBefore, isAfter, isEqual } from "date-fns";

// convert ISO-string ↔ Date
export const toDate = (iso: OCTDate) => new Date(iso + "T00:00:00Z");
export const toISO = (d: Date): OCTDate =>
  d.toISOString().slice(0, 10) as OCTDate;

export function addMonthsRule(
  iso: OCTDate,
  months: number,
  ctx: EvaluationContext,
): OCTDate {
  const d = toDate(iso); // original date (UTC)

  // --- Compute target (year, month) in UTC
  const y0 = d.getUTCFullYear();
  const m0 = d.getUTCMonth();
  const mSum = m0 + months;
  const ty = y0 + Math.floor(mSum / 12);
  const tm = ((mSum % 12) + 12) % 12;

  // --- Last day of target month in UTC: day 0 next month
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();

  const pickDay = (): number => {
    switch (ctx.vesting_day_of_month) {
      case "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH":
        return Math.min(d.getUTCDate(), lastDay);
      case "29_OR_LAST_DAY_OF_MONTH":
        return Math.min(29, lastDay);
      case "30_OR_LAST_DAY_OF_MONTH":
        return Math.min(30, lastDay);
      case "31_OR_LAST_DAY_OF_MONTH":
        return Math.min(31, lastDay);
      default:
        // clamp to last day to avoid overflow
        return Math.min(parseInt(ctx.vesting_day_of_month, 10), lastDay);
    }
  };

  const result = new Date(Date.UTC(ty, tm, pickDay()));
  return toISO(result);
}

export const addDays = (iso: OCTDate, n: number): OCTDate =>
  toISO(dfAddDays(toDate(iso), n));

export const lt = (a: OCTDate, b: OCTDate) => isBefore(toDate(a), toDate(b));
export const gt = (a: OCTDate, b: OCTDate) => isAfter(toDate(a), toDate(b));
export const eq = (a: OCTDate, b: OCTDate) => isEqual(toDate(a), toDate(b));

export function nextDate(
  d: OCTDate,
  unit: PeriodTag,
  length: number,
  ctx: EvaluationContext,
): OCTDate {
  return unit === "MONTHS" ? addMonthsRule(d, length, ctx) : addDays(d, length);
}
