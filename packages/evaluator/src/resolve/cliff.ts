// Lower a DSL cliff (`VestingNodeExpr`) onto core's time-based `Cliff`.
//
// Resolve the cliff expression against runtime (reusing the selector layer, with
// the vesting start overlaid so `vestingStart`-relative cliffs resolve), then
// express it as `{ length, period_type, percentage }`:
//   - the duration is measured from the statement anchor to the resolved cliff
//     date, in the statement's period_type when that lands exactly, else in DAYS
//     (always exact, so the lowered cliff reproduces the same date);
//   - the percentage is the proportional pre-cliff share m/N (DSL cliffs are
//     always proportional; non-proportional cliffs arrive only via OCF data).
//
// A bare event cliff (`CLIFF EVENT "ipo"`) is not a `cliff` field; Carta has no
// event anchor on the cliff. It's reported so the classifier (4b) can route it
// structurally, to events-only. An unresolved cliff is reported with blockers.

import type {
  Blocker,
  EvaluationContext,
  OCTDate,
  VestingNodeExpr,
} from "@vestlang/types";
import type {
  Cliff,
  PeriodTag,
  PeriodType,
  VestingDayOfMonth,
} from "@vestlang/types";
import { addPeriod, fracReduce, gt, toDate } from "@vestlang/core";
import { evaluateVestingNodeExpr } from "../evaluate/selectors.js";
import { isPickedResolved } from "../evaluate/utils.js";

const MS_PER_DAY = 86_400_000;

export type LoweredCliff =
  | { state: "NONE" }
  | { state: "RESOLVED"; cliff: Cliff }
  // Event-anchored cliff: no time-based `cliff` representation.
  | { state: "EVENT"; eventId: string }
  | { state: "UNRESOLVED"; blockers: Blocker[] };

const dayCount = (from: OCTDate, to: OCTDate): number =>
  Math.round((toDate(to).getTime() - toDate(from).getTime()) / MS_PER_DAY);

/**
 * Find (length, period_type) such that `addPeriod(anchor, length, period_type)`
 * === cliffDate: prefer the statement's period_type when the cliff lands on an
 * exact number of those units, else fall back to exact DAYS.
 */
const measureDuration = (
  anchor: OCTDate,
  cliffDate: OCTDate,
  periodType: PeriodType,
  dom: VestingDayOfMonth,
): { length: number; period_type: PeriodType } => {
  // Bounded probe in the statement's unit (cap well above any real schedule).
  for (let k = 1; k <= 1200; k++) {
    const d = addPeriod(anchor, k, periodType, dom);
    if (d === cliffDate) return { length: k, period_type: periodType };
    if (gt(d, cliffDate)) break;
  }
  return { length: dayCount(anchor, cliffDate), period_type: "DAYS" };
};

/** A bare, non-`vestingStart` event anchor: no time-based cliff field. */
const eventCliffId = (expr: VestingNodeExpr): string | undefined =>
  expr.type === "SINGLETON" &&
  expr.base.type === "EVENT" &&
  expr.base.value !== "vestingStart"
    ? expr.base.value
    : undefined;

// `origin` is the date the whole chain started from, used only to count how many
// grid occurrences fall on/before the cliff. A chain segment whose anchor was
// clamped onto a short month (Jan 31 handoff lands on Feb 28) still lays its grid
// on the chain's original day where the calendar allows it, so the count has to
// be taken against that sprung grid — the same grid core later partitions the
// lump on. If the two disagreed, the percentage baked in here wouldn't match how
// core splits the tranches and the boundary tranche would be misallocated. It
// defaults to `anchor`, so a head or any non-chained statement (its own origin)
// is unaffected. The cliff *date* below is left origin-blind on purpose: a cliff
// is a fixed duration from this segment's anchor, so it lands wherever that
// duration puts it regardless of how the grid day springs back.
export const lowerCliff = (
  cliffExpr: VestingNodeExpr | undefined,
  anchor: OCTDate,
  periodType: PeriodType,
  period: number,
  occurrences: number,
  ctx: EvaluationContext,
  origin: OCTDate = anchor,
): LoweredCliff => {
  if (!cliffExpr) return { state: "NONE" };

  // A genuinely event-anchored cliff is not a time-based cliff field.
  const evId = eventCliffId(cliffExpr);
  if (evId) return { state: "EVENT", eventId: evId };

  // Resolve the cliff date, overlaying the vesting start so a `vestingStart`-
  // relative cliff (e.g. "+12 months") resolves.
  const overlayCtx: EvaluationContext = {
    ...ctx,
    events: { ...ctx.events, vestingStart: anchor },
  };
  const res = evaluateVestingNodeExpr(cliffExpr, overlayCtx);

  // A cliff date is known only when the expression fully resolves. A partial
  // LATER_OF (e.g. `LATER OF(+12 months, EVENT ipo)` with ipo unfired) must not
  // collapse to its resolved branch: that branch is only a lower bound, so the
  // pending event can only push the cliff later. Reporting the floor as RESOLVED
  // would over-vest a still-contingent grant, so leave it UNRESOLVED, mirroring
  // the start path's partial-knowledge handling.
  const cliffDate: OCTDate | undefined = isPickedResolved(res)
    ? res.meta.date
    : undefined;

  if (!cliffDate) {
    const blockers: Blocker[] =
      res.type === "PICKED"
        ? res.meta.type === "UNRESOLVED"
          ? res.meta.blockers
          : []
        : res.blockers;
    return { state: "UNRESOLVED", blockers };
  }

  // Cliff at/before the start has no effect.
  if (!gt(cliffDate, anchor)) return { state: "NONE" };

  const dom: VestingDayOfMonth = ctx.vesting_day_of_month;

  // Proportional pre-cliff share: occurrences whose grid date is <= cliffDate,
  // counted on the origin-sprung grid (see the note on `origin` above).
  let m = 0;
  for (let i = 1; i <= occurrences; i++) {
    if (gt(addPeriod(anchor, i * period, periodType, dom, origin), cliffDate))
      break;
    m++;
  }
  if (m === 0) return { state: "NONE" };

  const { length, period_type } = measureDuration(
    anchor,
    cliffDate,
    periodType,
    dom,
  );
  return {
    state: "RESOLVED",
    cliff: {
      length,
      period_type,
      percentage: fracReduce({ numerator: m, denominator: occurrences }),
    },
  };
};

/** A `vestingStart + <duration>` cliff's offset, when the expression is exactly
 *  that: a bare SINGLETON on the `vestingStart` anchor with one positive duration
 *  offset and no condition. Any other shape (a different anchor, a condition, a
 *  combinator, multiple offsets) returns undefined. */
const vestingStartOffset = (
  expr: VestingNodeExpr,
): { value: number; unit: PeriodTag } | undefined => {
  if (
    expr.type !== "SINGLETON" ||
    expr.base.type !== "EVENT" ||
    expr.base.value !== "vestingStart" ||
    expr.condition !== undefined ||
    expr.offsets.length !== 1
  )
    return undefined;
  const off = expr.offsets[0];
  return off.sign === "PLUS" ? { value: off.value, unit: off.unit } : undefined;
};

/**
 * Lower a cliff for a *deferred* start — a pending atomic event or a synthetic
 * combinator event — where there is no concrete anchor date to resolve against.
 *
 * Only a `vestingStart`-relative duration cliff in the grid's own unit is
 * derivable anchor-free: `length`/`period_type` are the offset itself, and the
 * pre-cliff share is `floor(cliffLength / step) / occurrences` — independent of
 * when the event eventually fires (a 12-month cliff on a 1-month/48 grid is
 * always 12/48 = 25%). Core's compile then applies it at the firing date,
 * reproducing exactly what the already-fired case (anchored `lowerCliff`) yields.
 *
 * Everything else needs the firing date and is reported UNRESOLVED so the caller
 * keeps the statement unresolved: an event cliff (`CLIFF EVENT x`, no time-based
 * form — kept here so a pending start with one stays unresolved rather than
 * routing to events-only), or a cliff whose unit differs from the grid's (a
 * months-cliff over a days-grid counts a varying number of pre-cliff occurrences
 * depending on the anchor).
 */
export const lowerDeferredCliff = (
  cliffExpr: VestingNodeExpr | undefined,
  periodType: PeriodType,
  period: number,
  occurrences: number,
): LoweredCliff => {
  if (!cliffExpr) return { state: "NONE" };

  const off = vestingStartOffset(cliffExpr);
  // Anchor-free only when the cliff and the grid share a unit; otherwise the
  // pre-cliff count depends on the (still-unknown) firing date.
  if (!off || off.unit !== periodType)
    return { state: "UNRESOLVED", blockers: [] };

  if (off.value <= 0) return { state: "NONE" };
  const m = Math.min(Math.floor(off.value / period), occurrences);
  if (m === 0) return { state: "NONE" };

  return {
    state: "RESOLVED",
    cliff: {
      length: off.value,
      period_type: off.unit,
      percentage: fracReduce({ numerator: m, denominator: occurrences }),
    },
  };
};
