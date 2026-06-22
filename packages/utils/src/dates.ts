// Calendar-date helpers for canonical ISO dates (YYYY-MM-DD): the validity
// guard every input boundary shares, plus "what's today" in the same form.
//
// The date *arithmetic* lives in @vestlang/primitives; this is just the guard that
// every input boundary shares — the grammar's DATE literal and the MCP server's
// zod schema both reject impossible dates through here, so "is 2025-02-31 a real
// date?" gets one answer instead of three. Dependency-free, like the rest of
// this package.

import type { OCTDate } from "@vestlang/types";

const daysInMonth = (year: number, month: number): number => {
  // Gregorian leap rule; month is 1-based.
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
};

/**
 * True when `s` is a real calendar date in canonical `YYYY-MM-DD` form: a 4-digit
 * year in 0001–9999, a month 01–12, and a day that exists in that month (leap
 * years included). Rejects the lexically-plausible impossibles the bare regex
 * lets through — `2025-02-31`, `2025-13-01`, `2025-00-00`, `0000-01-01`.
 */
export function isValidCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

/**
 * Today's date as a canonical `YYYY-MM-DD` string. Read in the host's *local*
 * timezone on purpose: when a caller evaluates a schedule "as of today" without
 * naming a date, "today" should mean the user's today, not UTC's — near
 * midnight those can differ by a day.
 */
export function todayISO(): OCTDate {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
