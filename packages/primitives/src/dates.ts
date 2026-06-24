// Policy-aware, DST-safe date math over canonical ISO dates (YYYY-MM-DD).
//
// Ported from vestlang's interpret/time.ts. Two adaptations when it moved into the
// engine substrate:
//   - the day-of-month policy is passed directly as a VestingDayOfMonth value
//     (there's no evaluator context here to read it off); it defaults to the
//     canonical default, VESTING_START_DAY_OR_LAST_DAY_OF_MONTH.
//   - comparisons are plain string comparisons. Zero-padded ISO dates sort
//     lexicographically, so this matches calendar order without pulling in
//     date-fns — primitives ships date-fns-free.
//
// All stepping is done in UTC (dates built at UTC midnight, read back in UTC),
// so day arithmetic never drifts across DST transitions.

import type {
  ConstraintTag,
  OCTDate,
  PeriodType,
  VestingDayOfMonth,
} from "@vestlang/types";
import {
  DEFAULT_VESTING_DAY_OF_MONTH,
  isNumericDayOfMonth,
} from "@vestlang/types";
import { assertNever } from "@vestlang/utils";

// ISO-string ↔ Date (UTC midnight).
//
// Both directions go through explicit components rather than string parsing /
// `toISOString()`. The string paths mishandle the year at both ends: `Date.UTC`
// (and `new Date(year, …)`) remap years 0–99 to 1900–1999, and `toISOString()`
// switches to extended notation (`+010000-…`) above year 9999, which then gets
// truncated to a malformed date. `setUTCFullYear` takes the full year verbatim,
// so building this way is exact across the whole 0001–9999 range.
const pad = (n: number, width: number): string =>
  String(n).padStart(width, "0");

const utcMidnight = (year: number, monthIdx: number, day: number): Date => {
  const d = new Date(0);
  d.setUTCFullYear(year, monthIdx, day);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

export const toDate = (iso: OCTDate): Date => {
  const [y, m, d] = iso.split("-").map(Number);
  return utcMidnight(y, m - 1, d);
};

export const toISO = (d: Date): OCTDate => {
  const y = d.getUTCFullYear();
  // A large day/week step can push the Date past the ±8.64e15 ms limit, at which
  // point every UTC getter returns NaN. Comparisons against NaN are always false,
  // so the plain `y < 1 || y > 9999` test would let it through and `pad` would
  // emit "0NaN-NaN-NaN". Reject the overflow here too, on the same range error
  // the in-bounds-year checks raise — there's no surviving year left to report.
  if (Number.isNaN(y)) {
    throw new RangeError(
      "date out of representable range 0001–9999 (arithmetic overflowed)",
    );
  }
  if (y < 1 || y > 9999) {
    throw new RangeError(
      `date out of representable range 0001–9999 (got year ${y})`,
    );
  }
  return `${pad(y, 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
};

/**
 * Step `months` calendar months from `iso`, picking the target day-of-month per
 * the policy and clamping to the last day of shorter months (e.g. Jan 31 + 1mo
 * → Feb 28/29).
 *
 * `origin` is the date whose day-of-month the VESTING_START policy targets. It
 * defaults to `iso` — the date we're stepping from — which reproduces the
 * plain "keep the day you started on" behavior. Callers walking a chain across
 * several segments pass the chain's first date instead, which is the policy: a
 * grant keeps one vesting day, the origin's, and every MONTHS segment anchors to
 * it. A preceding DAYS segment can hand off mid-month (Jan 31 + 27d → Feb 27),
 * and a short month can clamp the handoff (Feb has no 31st), but neither sticks
 * — this step targets the origin day and clamps to the month's last day only
 * where the calendar forces it. Only this policy reads `origin`; the others
 * target a fixed day regardless.
 */
export function addMonthsRule(
  iso: OCTDate,
  months: number,
  dayOfMonth: VestingDayOfMonth = DEFAULT_VESTING_DAY_OF_MONTH,
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
  const lastDay = utcMidnight(ty, tm + 1, 0).getUTCDate();

  const pickDay = (): number => {
    // A fixed numeric day "01"–"28" picks itself. The clamp is provably a no-op
    // here — every value the guard admits is ≤28, below every month's last day —
    // but it's kept as an executable statement of the "day ≤ month length"
    // invariant the named policies below have to enforce for real.
    if (isNumericDayOfMonth(dayOfMonth)) {
      return Math.min(parseInt(dayOfMonth, 10), lastDay);
    }
    // The four named policies resolve to a month-end fallback. Exhaustive over
    // `NamedDayPolicy`, so a fifth named policy is a typecheck error at the
    // `assertNever` default rather than a silent fall-through.
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
        return assertNever(dayOfMonth);
    }
  };

  return toISO(utcMidnight(ty, tm, pickDay()));
}

/**
 * Whole calendar months from `from` to `to`, plus the leftover days — the
 * closed-form inverse of `addMonthsRule` under its default
 * VESTING_START_DAY_OR_LAST_DAY_OF_MONTH rule. So
 * `monthsBetween(d, addMonthsRule(d, k))` is `{ diff: k, remainderDays: 0 }`
 * for every k.
 *
 * Both fields are signed by direction: `diff` is negative when `to` precedes
 * `from`, and `remainderDays` carries the same sign (it is `daysBetween` from
 * the clamped anchor to `to`).
 *
 * The month count is asymmetric near a month-end clamp, by design. Forward, the
 * final month is complete once `to` reaches the day `addMonthsRule` would land
 * on — that's `from`'s day clamped to the *target* month's length, so a clamped
 * endpoint counts as a full month (Jan 31 → Feb 28 is one month, matching
 * `addMonthsRule(Jan 31, 1)`). Backward, no clamp can apply: the target day is
 * `from`'s own day in `from`'s own month, which always fits, so the comparison
 * is the plain `td > fd`. The two directions therefore aren't mirror images —
 * `monthsBetween(a, b).diff` is not universally `-monthsBetween(b, a).diff`
 * across a clamp.
 */
export function monthsBetween(
  from: OCTDate,
  to: OCTDate,
): { diff: number; remainderDays: number } {
  const f = toDate(from);
  const t = toDate(to);
  const fy = f.getUTCFullYear();
  const fm = f.getUTCMonth();
  const fd = f.getUTCDate();
  const ty = t.getUTCFullYear();
  const tm = t.getUTCMonth();
  const td = t.getUTCDate();

  // Last day of the target month, via day 0 of the next month — the same idiom
  // addMonthsRule uses for its month-end clamp.
  const targetLastDay = utcMidnight(ty, tm + 1, 0).getUTCDate();

  const direction = t.getTime() >= f.getTime() ? 1 : -1;
  let diff = (ty - fy) * 12 + (tm - fm);
  if (direction === 1 && td < Math.min(fd, targetLastDay)) {
    // Forward: the final month isn't complete until `to` reaches `from`'s day
    // clamped to the target month's length.
    diff -= 1;
  }
  if (direction === -1 && td > fd) {
    // Backward: the landing day is `from`'s day in `from`'s own month, so it can
    // never overflow that month — clamping it would be a no-op (min(fd, …) is
    // always fd, since fd is already a valid day of fm). A plain `td > fd` is
    // the exact same test.
    diff += 1;
  }

  // Remainder runs from the month-aligned anchor to `to`. The anchor takes its
  // day from `from` (default origin), so it keeps `from`'s day where the month
  // allows and clamps to month-end where it doesn't.
  const anchor = addMonthsRule(from, diff);
  const remainderDays = daysBetween(anchor, to);

  return { diff, remainderDays };
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
 * `origin` is forwarded to the month stepper (see `addMonthsRule`), which targets
 * the origin's day-of-month — the grant's single vesting day. It defaults to
 * `start`, so callers that don't chain get the usual step-from-start behavior.
 * DAYS ignore it.
 */
export const addPeriod = (
  start: OCTDate,
  units: number,
  periodType: PeriodType,
  dayOfMonth: VestingDayOfMonth = DEFAULT_VESTING_DAY_OF_MONTH,
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
// the chain-origin day-of-month policy (#34, #171) is computed in one place rather
// than two that could drift apart. Pass `origin` (the chain's first date) so the
// day-of-month is taken from there rather than from this segment's anchor: the
// whole grant vests on the origin's day, so a handoff that fell mid-month or got
// clamped onto a short month doesn't carry that day forward. It defaults to the
// anchor for callers that don't chain.
export const advanceCursor = (
  anchor: OCTDate,
  occurrences: number,
  period: number,
  periodType: PeriodType,
  dayOfMonth: VestingDayOfMonth = DEFAULT_VESTING_DAY_OF_MONTH,
  origin: OCTDate = anchor,
): OCTDate =>
  addPeriod(anchor, occurrences * period, periodType, dayOfMonth, origin);

// Comparisons on ISO YYYY-MM-DD strings (lexicographic == calendar order).
export const lt = (a: OCTDate, b: OCTDate): boolean => a < b;
export const gt = (a: OCTDate, b: OCTDate): boolean => a > b;
export const eq = (a: OCTDate, b: OCTDate): boolean => a === b;

// Does `subject` satisfy a single BEFORE/AFTER bound anchored at `base`? This is
// the one per-edge rule both the evaluator (deciding a fired/literal proviso) and
// the linter (deciding whether a date window is empty) lean on, so it lives here
// rather than being re-derived in each.
//
// `strict` is the STRICTLY modifier from the DSL: bare BEFORE/AFTER admit the
// boundary day, STRICTLY excludes it.
//   BEFORE         subject <= base   (STRICTLY: subject < base)
//   AFTER          subject >= base   (STRICTLY: subject > base)
export const satisfiesRelation = (
  relation: ConstraintTag,
  strict: boolean,
  subject: OCTDate,
  base: OCTDate,
): boolean => {
  switch (relation) {
    case "BEFORE":
      return strict
        ? lt(subject, base)
        : lt(subject, base) || eq(subject, base);
    case "AFTER":
      return strict
        ? gt(subject, base)
        : gt(subject, base) || eq(subject, base);
    default:
      // A future third relation lands here as a typecheck error, not a silent pass.
      return assertNever(relation);
  }
};

// Whole calendar days from `a` to `b` (negative when `b` precedes `a`). Both
// dates are UTC midnights via `toDate`, so the millisecond span is an exact
// multiple of a day and the division is clean — no DST partial-day to round off.
export const daysBetween = (a: OCTDate, b: OCTDate): number =>
  Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
