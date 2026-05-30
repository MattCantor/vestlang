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
// A bare event cliff (`CLIFF EVENT "ipo"`) is NOT a `cliff` field — Carta has no
// event anchor on the cliff. It's reported so the classifier (4b) can route it
// structurally / to events-only. An unresolved cliff is reported with blockers.

import type {
  Blocker,
  EvaluationContext,
  OCTDate,
  VestingNodeExpr,
} from "@vestlang/types";
import type { Cliff, PeriodType, VestingDayOfMonth } from "@vestlang/core";
import { addPeriod, fracReduce, gt, toDate } from "@vestlang/core";
import { evaluateVestingNodeExpr } from "../evaluate/selectors.js";
import { isPickedResolved } from "../evaluate/utils.js";

const MS_PER_DAY = 86_400_000;

export type LoweredCliff =
  | { state: "NONE" }
  | { state: "RESOLVED"; cliff: Cliff }
  // Event-anchored cliff — has no time-based `cliff` representation.
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

/** A bare, non-`vestingStart` event anchor → no time-based cliff field. */
const eventCliffId = (expr: VestingNodeExpr): string | undefined =>
  expr.type === "SINGLETON" &&
  expr.base.type === "EVENT" &&
  expr.base.value !== "vestingStart"
    ? expr.base.value
    : undefined;

export const lowerCliff = (
  cliffExpr: VestingNodeExpr | undefined,
  anchor: OCTDate,
  periodType: PeriodType,
  period: number,
  occurrences: number,
  ctx: EvaluationContext,
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

  // A cliff date is known ONLY when the expression fully resolves. A partial
  // LATER_OF (e.g. `LATER OF(+12 months, EVENT ipo)` with ipo unfired) must NOT
  // collapse to its resolved branch: that branch is only a lower bound, so the
  // pending event can only push the cliff later. Reporting the floor as RESOLVED
  // would over-vest a still-contingent grant — so leave it UNRESOLVED, mirroring
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

  // Proportional pre-cliff share: occurrences whose grid date is <= cliffDate.
  let m = 0;
  for (let i = 1; i <= occurrences; i++) {
    if (gt(addPeriod(anchor, i * period, periodType, dom), cliffDate)) break;
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
