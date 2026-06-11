// The share-allocation kernel, pulled into one place so the canonical compiler
// and the evaluator's runtime resolver share a single copy instead of two that
// can drift.
//
// expandGrid lays out a statement's vesting dates and assigns each the fraction of
// the grant it carries, applying the cliff by calendar date rather than by
// counting occurrences. allocateEvents turns a bag of those fractional events into
// exact integer share counts. Neither knows where its input came from — that's
// what lets both engines call them.

import type {
  Fraction,
  OCTDate,
  PeriodType,
  VestingDayOfMonth,
} from "@vestlang/types";
import {
  fracAdd,
  fracMul,
  fracReduce,
  fracSub,
  ONE,
  ZERO,
} from "@vestlang/utils";
import { addPeriod, gt } from "./dates";
import { allocateExact } from "./allocate";
import { foldToGrantDate } from "./fold";

/**
 * One vesting date with the fraction of the whole grant it carries, before that
 * fraction becomes an integer share count. `occurrence` is the grid index (1..N);
 * a cliff lump uses 0 so it sorts ahead of any same-day grid point.
 */
export interface RawEvent {
  date: OCTDate;
  fractionOfGrant: Fraction;
  statementOrder: number;
  occurrence: number;
}

/**
 * A cliff whose date is already worked out, tagged by where its percentage comes
 * from. A duration cliff knows its percentage up front (`fixed`); a cliff pinned to
 * a fired event doesn't, and instead takes whatever share of the grid falls at or
 * before it (`proportional`). The layout never needs to know which produced the
 * date — only how to size the lump.
 */
export type GridCliff =
  | { kind: "none" }
  | { kind: "fixed"; date: OCTDate; percentage: Fraction }
  | { kind: "proportional"; date: OCTDate };

export interface ExpandGridArgs {
  anchor: OCTDate;
  // The chain's first date, and the day-of-month every MONTHS segment grids on:
  // one vesting day per grant. A segment whose anchor landed mid-month or clamped
  // onto a short month still vests on the origin's day where the calendar allows.
  // Equal to `anchor` for a self-anchored statement.
  origin: OCTDate;
  period: number;
  periodType: PeriodType;
  occurrences: number;
  // Fraction of the whole grant this statement covers, already scaled by any
  // partial-payout multiplier. Every emitted fraction derives from it.
  stmtFraction: Fraction;
  statementOrder: number;
  dom: VestingDayOfMonth | undefined;
  cliff: GridCliff;
}

/**
 * The grid's date function: occurrence `i` lands `i` periods past the anchor. Built
 * once and shared, so expansion and the count-only callers walk identical dates.
 */
export const gridDate =
  (
    p: Pick<
      ExpandGridArgs,
      "anchor" | "origin" | "period" | "periodType" | "dom"
    >,
  ) =>
  (i: number): OCTDate =>
    addPeriod(p.anchor, i * p.period, p.periodType, p.dom, p.origin);

/**
 * Lay out one statement's vesting events — dates, the fraction of grant each
 * carries, and the cliff applied by date.
 *
 * No cliff, or one that has already passed by the time vesting starts: every
 * occurrence vests an equal slice on its own grid date.
 *
 * A cliff that bites: occurrences at or before the cliff date collapse into one
 * lump on that date; the rest split what's left evenly, each on its grid date. The
 * lump's size is the cliff's own percentage when it has one, otherwise the share of
 * occurrences that fell behind it.
 */
export const expandGrid = (args: ExpandGridArgs): RawEvent[] => {
  const {
    anchor,
    origin,
    period,
    periodType,
    occurrences: N,
    stmtFraction,
    statementOrder,
    dom,
    cliff,
  } = args;

  const at = gridDate({ anchor, origin, period, periodType, dom });
  const event = (
    date: OCTDate,
    fraction: Fraction,
    occurrence: number,
  ): RawEvent => ({
    date,
    fractionOfGrant: fraction,
    statementOrder,
    occurrence,
  });
  const evenGrid = (): RawEvent[] => {
    const per = fracMul(stmtFraction, { numerator: 1, denominator: N });
    return Array.from({ length: N }, (_, idx) =>
      event(at(idx + 1), per, idx + 1),
    );
  };

  // A cliff dated on or before the anchor holds nothing back — treat it as no
  // cliff and vest the plain even grid. (This is also what keeps a zero-spacing
  // grid, where every occurrence lands on the start date, from dropping the shares
  // the lump didn't cover.)
  if (cliff.kind === "none" || !gt(cliff.date, anchor)) return evenGrid();

  const cliffDate = cliff.date;

  // Split the occurrences around the cliff date: those strictly after it keep their
  // own grid date, the rest fold into the lump.
  const postOccurrences: number[] = [];
  let preCount = 0;
  for (let i = 1; i <= N; i++) {
    if (gt(at(i), cliffDate)) postOccurrences.push(i);
    else preCount++;
  }

  // The cliff sits before the first installment → nothing to hold back, even grid.
  if (preCount === 0) return evenGrid();

  // A fixed cliff smaller than the whole statement needs at least one occurrence
  // strictly after the cliff date to carry the (1 − percentage) the lump doesn't
  // take. When the cliff swallows the entire grid there is nowhere for the
  // remainder to vest — refuse loudly rather than drop it. The DSL can't get
  // here: it pins the cliff percentage to the pre-cliff share of the grid, which
  // is exactly 1 in the swallowed case. Only direct template input can.
  if (
    postOccurrences.length === 0 &&
    cliff.kind === "fixed" &&
    cliff.percentage.numerator !== cliff.percentage.denominator
  ) {
    throw new Error(
      `expandGrid: statement ${statementOrder}: fixed cliff with percentage < 1 leaves no occurrence after the cliff date; the remaining fraction would silently vanish`,
    );
  }

  const pct =
    cliff.kind === "fixed"
      ? cliff.percentage
      : fracReduce({ numerator: preCount, denominator: N });

  const events: RawEvent[] = [event(cliffDate, fracMul(stmtFraction, pct), 0)];

  // Whatever the lump didn't take spreads evenly over the occurrences after the
  // cliff. None after it — the cliff is at or past the last grid date — means the
  // lump is the whole statement.
  const P = postOccurrences.length;
  if (P > 0) {
    const per = fracMul(
      stmtFraction,
      fracMul(fracSub(ONE, pct), { numerator: 1, denominator: P }),
    );
    for (const i of postOccurrences) events.push(event(at(i), per, i));
  }
  return events;
};

/**
 * Turn fractional events into exact integer share counts. Events sort by date
 * (ties broken by statement order, then occurrence, so a cliff lump leads its day),
 * then a single running cumulative walks them: each amount is what rounding the
 * cumulative fraction down to whole shares adds beyond what's vested so far, so the
 * run telescopes to exactly `totalShares`. Events that round to nothing drop out.
 * Given a grant date, amounts dated before it aggregate onto it.
 */
export const allocateEvents = (
  events: RawEvent[],
  totalShares: number,
  grantDate?: OCTDate,
): { date: OCTDate; amount: number }[] => {
  const sorted = [...events].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.statementOrder !== b.statementOrder)
      return a.statementOrder - b.statementOrder;
    return a.occurrence - b.occurrence;
  });

  let cumulative: Fraction = ZERO;
  let vestedSoFar = 0;
  const dates: OCTDate[] = [];
  const amounts: number[] = [];
  for (const e of sorted) {
    cumulative = fracAdd(cumulative, e.fractionOfGrant);
    const amount = allocateExact(totalShares, cumulative, vestedSoFar);
    if (amount === 0) continue;
    vestedSoFar += amount;
    dates.push(e.date);
    amounts.push(amount);
  }

  const folded = grantDate
    ? foldToGrantDate(dates, amounts, grantDate)
    : { dates, amounts };
  return folded.dates.map((date, i) => ({ date, amount: folded.amounts[i] }));
};
