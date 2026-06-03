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

import type { OCTDate, PeriodType, VestingDayOfMonth } from "@vestlang/types";

const DEFAULT_DAY_OF_MONTH: VestingDayOfMonth =
  "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH";

// ISO-string ↔ Date (UTC midnight)
export const toDate = (iso: OCTDate): Date => new Date(iso + "T00:00:00Z");
export const toISO = (d: Date): OCTDate => d.toISOString().slice(0, 10);

/**
 * Step `months` calendar months from `iso`, picking the target day-of-month per
 * the policy and clamping to the last day of shorter months (e.g. Jan 31 + 1mo
 * → Feb 28/29).
 *
 * `origin` is the date whose day-of-month the VESTING_START policy targets. It
 * defaults to `iso` — the date we're stepping from — which reproduces the
 * plain "keep the day you started on" behavior. Callers walking a chain across
 * several segments pass the chain's first date instead, so a handoff that got
 * clamped to a short month (Jan 31 → Feb 28) doesn't drag the rest of the chain
 * onto the 28th: the day still springs back to 31 wherever the month allows it.
 * Only this policy reads `origin`; the others target a fixed day regardless.
 */
export function addMonthsRule(
  iso: OCTDate,
  months: number,
  dayOfMonth: VestingDayOfMonth = DEFAULT_DAY_OF_MONTH,
  origin: OCTDate = iso,
): OCTDate {
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
        return Math.min(toDate(origin).getUTCDate(), lastDay);
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
export const addDays = (iso: OCTDate, n: number): OCTDate => {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
};

/**
 * Step `units` of `periodType` from `start`. YEARS are months × 12 (so the same
 * day-of-month clamping applies). DAYS ignore the day-of-month policy.
 *
 * `origin` is forwarded to the month stepper (see `addMonthsRule`); it defaults
 * to `start`, so callers that don't care about chain origin get the usual
 * step-from-start behavior. DAYS ignore it.
 */
export const addPeriod = (
  start: OCTDate,
  units: number,
  periodType: PeriodType,
  dayOfMonth: VestingDayOfMonth = DEFAULT_DAY_OF_MONTH,
  origin: OCTDate = start,
): OCTDate => {
  switch (periodType) {
    case "DAYS":
      return addDays(start, units);
    case "MONTHS":
      return addMonthsRule(start, units, dayOfMonth, origin);
    case "YEARS":
      return addMonthsRule(start, units * 12, dayOfMonth, origin);
  }
};

// Where the next segment of a graded (multi-tranche) schedule begins. A segment
// covers `occurrences` periods of `period` units each, so its end — and the start
// of whatever follows it — is that whole span stepped forward from the anchor.
// The canonical compiler and the evaluator's chaining pre-pass both call this, so
// the short-month clamping quirk (Jan 31 handoff lands on Feb 28, see #34) has a
// single place to be fixed rather than two that could drift apart. Pass `origin`
// (the chain's first date) so the clamped day-of-month is taken from there rather
// than from this segment's anchor; it defaults to the anchor for callers that
// don't chain.
export const advanceCursor = (
  anchor: OCTDate,
  occurrences: number,
  period: number,
  periodType: PeriodType,
  dayOfMonth: VestingDayOfMonth = DEFAULT_DAY_OF_MONTH,
  origin: OCTDate = anchor,
): OCTDate =>
  addPeriod(anchor, occurrences * period, periodType, dayOfMonth, origin);

// Comparisons on ISO YYYY-MM-DD strings (lexicographic == calendar order).
export const lt = (a: OCTDate, b: OCTDate): boolean => a < b;
export const gt = (a: OCTDate, b: OCTDate): boolean => a > b;
export const eq = (a: OCTDate, b: OCTDate): boolean => a === b;
