import { OCTDate } from "@vestlang/types";
import {
  addDays as dfAddDays,
  addMonths,
  endOfMonth,
  isBefore,
  isAfter,
  isEqual,
} from "date-fns";

// convert ISO-string ↔ Date
export const toDate = (iso: OCTDate) => new Date(iso + "T00:00:00Z");
export const toISO = (d: Date): OCTDate =>
  d.toISOString().slice(0, 10) as OCTDate;

/** “Vesting date or last day of month” rule */
// TODO: Replace this with existing implementation
export function addMonthsRule(iso: OCTDate, months: number): OCTDate {
  const d = toDate(iso);
  const next = addMonths(d, months);
  // if target month has fewer days, clamp to endOfMonth
  if (d.getUTCDate() !== next.getUTCDate()) return toISO(endOfMonth(next));
  return toISO(next);
}

export const addDays = (iso: OCTDate, n: number): OCTDate =>
  toISO(dfAddDays(toDate(iso), n));

export const lt = (a: OCTDate, b: OCTDate) => isBefore(toDate(a), toDate(b));
export const gt = (a: OCTDate, b: OCTDate) => isAfter(toDate(a), toDate(b));
export const eq = (a: OCTDate, b: OCTDate) => isEqual(toDate(a), toDate(b));
