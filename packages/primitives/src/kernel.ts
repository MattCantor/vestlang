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
  OCFPeriodType,
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
import { addPeriod, gt } from "./dates.js";
import { allocateExact } from "./allocate.js";
import {
  byDateOrderOccurrence,
  foldToGrantDate,
  relocateToCliffDate,
} from "./fold.js";

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
  periodType: OCFPeriodType;
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
 * A cliff that bites: occurrences at or before the cliff date collapse into one
 * lump on that date; the rest split what's left evenly, each on its grid date. The
 * lump's size is the cliff's own percentage when it has one, otherwise the share of
 * occurrences that fell behind it.
 *
 * The two cliff kinds part ways at the edges. An event cliff (no stated
 * percentage) takes only what the grid accrued by its firing, so a firing on or
 * before the first installment simply yields the even grid. A duration cliff
 * carries an authored percentage and honors it wherever it can land — including on
 * the start date or before the first installment, where the lump still leads — and
 * throws only when the percentage can't be placed: below 100% with no installment
 * after the cliff (the remainder would vanish), or dated before the vesting start.
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

  // No cliff at all → the plain even grid, before any cliff date is read.
  if (cliff.kind === "none") return evenGrid();

  // An event cliff with no stated percentage takes whatever share of the grid sat
  // at or before its firing. A firing on or before the anchor holds nothing back
  // (even grid); a firing before the first installment likewise has a zero pre-cliff
  // share, so it stays an even grid rather than emitting a spurious zero lump.
  if (cliff.kind === "proportional") {
    if (!gt(cliff.date, anchor)) return evenGrid();
    const { pre, post } = splitAround(at, N, cliff.date);
    if (pre === 0) return evenGrid();
    const pct = fracReduce({ numerator: pre, denominator: N });
    return cliffLump(event, at, stmtFraction, cliff.date, pct, post);
  }

  // A fixed (duration) cliff carries its own stated percentage and must honor it
  // wherever it can land. A cliff date before the grant's vesting start can't —
  // vesting would fall before the grant began.
  if (gt(anchor, cliff.date)) {
    throw new Error(
      `expandGrid: statement ${statementOrder}: fixed cliff date ${cliff.date} falls before the statement's start ${anchor}`,
    );
  }

  const { post } = splitAround(at, N, cliff.date);
  const pct = cliff.percentage;
  const swallowsGrid = post.length === 0;
  const isFullGrant = pct.numerator === pct.denominator;

  // A cliff below 100% needs at least one installment strictly after it to carry
  // the remaining (1 − percentage). When the cliff swallows the whole grid (the
  // date sits at or past the last installment, or every installment lands on the
  // start with zero spacing) there is nowhere for that remainder to vest — refuse
  // loudly rather than drop it. A 100% cliff has no remainder, so it lands as one
  // full-grant lump even with nothing after it. The DSL can't reach this throw: it
  // pins a fixed cliff's percentage to the pre-cliff share of the grid, which is
  // exactly 1 when the cliff swallows the grid. Only direct template input can.
  if (swallowsGrid && !isFullGrant) {
    throw new Error(
      `expandGrid: statement ${statementOrder}: fixed cliff with percentage < 1 leaves no occurrence after the cliff date; the remaining fraction would silently vanish`,
    );
  }

  // The stated percentage lands as the lump on the cliff date — any installment at
  // or before it folds in (nothing vests pre-cliff) — and (1 − percentage) spreads
  // over the installments strictly after.
  return cliffLump(event, at, stmtFraction, cliff.date, pct, post);
};

/** The occurrences strictly after `cliffDate`, and how many fell at or before it. */
const splitAround = (
  at: (i: number) => OCTDate,
  N: number,
  cliffDate: OCTDate,
): { pre: number; post: number[] } => {
  const post: number[] = [];
  let pre = 0;
  for (let i = 1; i <= N; i++) {
    if (gt(at(i), cliffDate)) post.push(i);
    else pre++;
  }
  return { pre, post };
};

/**
 * The lump of `pct` on the cliff date (occurrence 0, so it leads its day), then
 * (1 − pct) split evenly over the post-cliff occurrences on their own grid dates.
 * No post-cliff occurrence means the lump is the whole statement.
 */
const cliffLump = (
  event: (date: OCTDate, fraction: Fraction, occurrence: number) => RawEvent,
  at: (i: number) => OCTDate,
  stmtFraction: Fraction,
  cliffDate: OCTDate,
  pct: Fraction,
  post: number[],
): RawEvent[] => {
  const events: RawEvent[] = [event(cliffDate, fracMul(stmtFraction, pct), 0)];
  if (post.length > 0) {
    const per = fracMul(
      stmtFraction,
      fracMul(fracSub(ONE, pct), { numerator: 1, denominator: post.length }),
    );
    for (const i of post) events.push(event(at(i), per, i));
  }
  return events;
};

/**
 * One surviving (post-telescope) event, with the statement it came from and the
 * integer shares it contributed. Index-aligned to the pre-fold `(dates, amounts)`
 * the headline aggregates, but never merged across statements, so attribution
 * survives. The date is folded the same way the headline is — a pre-grant row
 * relocates to `grantDate` — so `Σ contributions === Σ installments`.
 *
 * `scheduledDate` keeps the pre-fold grid position the relocation discards on
 * `date`, so a consumer can still report when a folded share would have vested
 * along the schedule (#441). The two are equal off the relocation path. Named
 * `scheduledDate`, not `gridDate` — that would collide with the exported `gridDate`
 * function above.
 */
export interface AllocationContribution {
  date: OCTDate;
  scheduledDate: OCTDate; // the pre-fold grid position (= RawEvent.date)
  statementOrder: number; // 1-based program order (RawEvent.statementOrder)
  occurrence: number; // RawEvent.occurrence (0 = cliff lump)
  amount: number; // integer shares
}

/**
 * The headline allocation paired with its per-event provenance. `installments` is
 * byte-for-byte `allocateEvents(...)`; `contributions` is the same surviving rows
 * un-merged, each tagged with its source statement.
 */
export interface ProvenancedAllocation {
  installments: { date: OCTDate; amount: number }[];
  contributions: AllocationContribution[];
}

/**
 * Turn fractional events into exact integer share counts AND a per-event
 * provenance carrier. Events sort by date (ties broken by statement order, then
 * occurrence, so a cliff lump leads its day), then a single running cumulative
 * walks them: each amount is what rounding the cumulative fraction down to whole
 * shares adds beyond what's vested so far, so the run telescopes to exactly
 * `totalShares`. Events that round to nothing drop out. Given a grant date, the
 * headline aggregates pre-grant amounts onto it (`foldToGrantDate`), while each
 * surviving contribution row relocates its own date to the grant date with no
 * cross-statement summing — so the partition's total matches the headline's but
 * keeps which statement vested what.
 */
export const allocateWithProvenance = (
  events: RawEvent[],
  totalShares: number,
  grantDate?: OCTDate,
): ProvenancedAllocation => {
  const sorted = [...events].sort(byDateOrderOccurrence);

  let cumulative: Fraction = ZERO;
  let vestedSoFar = 0;
  const dates: OCTDate[] = [];
  const amounts: number[] = [];
  const contributions: AllocationContribution[] = [];
  for (const e of sorted) {
    cumulative = fracAdd(cumulative, e.fractionOfGrant);
    const amount = allocateExact(totalShares, cumulative, vestedSoFar);
    if (amount === 0) continue;
    vestedSoFar += amount;
    dates.push(e.date);
    amounts.push(amount);
    contributions.push({
      date: grantDate ? relocateToCliffDate(e.date, grantDate) : e.date,
      scheduledDate: e.date,
      statementOrder: e.statementOrder,
      occurrence: e.occurrence,
      amount,
    });
  }

  const folded = grantDate
    ? foldToGrantDate(dates, amounts, grantDate)
    : { dates, amounts };
  return {
    installments: folded.dates.map((date, i) => ({
      date,
      amount: folded.amounts[i],
    })),
    contributions,
  };
};

/**
 * The headline-only allocation (no provenance). A thin wrapper over
 * `allocateWithProvenance` so the two can't drift; its bytes are unchanged.
 */
export const allocateEvents = (
  events: RawEvent[],
  totalShares: number,
  grantDate?: OCTDate,
): { date: OCTDate; amount: number }[] =>
  allocateWithProvenance(events, totalShares, grantDate).installments;
