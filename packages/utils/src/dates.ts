// Calendar-date helpers for canonical ISO dates (YYYY-MM-DD): the validity
// guard every input boundary shares, plus "what's today" in the same form.
//
// The date *arithmetic* lives in @vestlang/primitives; this is just the guard that
// every input boundary shares — the grammar's DATE literal and the MCP server's
// zod schema both reject impossible dates through here, so "is 2025-02-31 a real
// date?" gets one answer instead of three. Dependency-free, like the rest of
// this package.

import type { OCTDate } from "@vestlang/types";

// The storage-only placeholder a contingent vesting start carries in
// `runtime.startDate`: a blatantly-fake far-future date. A start whose calendar
// date isn't known until a named event fires can't carry a real date, so it
// stores this sentinel and holds the real recipe out-of-band in a reserved
// `evt:start` sidecar entry (re-derived on reload). Consumers may read the VALUE
// directly — the compiler (to recognize it and emit no dated tranches, since a
// real run off year 9999 overflows the date math in @vestlang/primitives) and the
// reload damaged-artifact check — but never the rehydrate OVERRIDE decision, which
// keys on the presence of the `evt:start` entry, not on this value.
//
// 9999-12-31 is the last representable date (primitives' toISO rejects past year
// 9999), so it is unmistakable AND cannot be stepped forward without throwing —
// exactly the fail-visible property we want. Named CONTINGENT_START_SENTINEL,
// distinct from the evaluator's unrelated VESTING_START_LABEL/isVestingStartPlaceholder.
//
// It lives here, beside isValidCalendarDate, so the input boundaries that must
// REFUSE a user-supplied copy of it (the value is a real calendar date, so the
// calendar check alone waves it through) can reserve it from the same source the
// storage layer mints it from.
export const CONTINGENT_START_SENTINEL: OCTDate = "9999-12-31";

/**
 * True when `d` is the reserved contingent-start placeholder. The user-input
 * boundaries call this to reject a literal `9999-12-31` a user typed — it is a
 * real calendar date (isValidCalendarDate accepts it), so it would otherwise
 * collide silently with the storage sentinel.
 */
export function isContingentStartSentinel(d: string): boolean {
  return d === CONTINGENT_START_SENTINEL;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Days in a given 1-based month, Gregorian leap rule applied. */
export const daysInMonth = (year: number, month: number): number => {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return DAYS_IN_MONTH[month - 1];
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
