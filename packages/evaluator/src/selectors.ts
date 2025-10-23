import {
  ScheduleExpr,
  PeriodTag,
  VestingPeriod,
  OCTDate,
  Schedule as NormalizedSchedule,
  SelectorTag,
} from "@vestlang/types";
import {
  EvaluationContext,
  ExpandedSchedule,
  PickedSchedule,
  Tranche,
} from "./types.js";
import { resolveNodeExpr } from "./resolve.js";
import { addMonthsRule, addDays, lt } from "./time.js";

/* ------------------------
 * Cadence helpers
 * ------------------------ */

// export function nextDate(
//   d: OCTDate,
//   unit: PeriodTag,
//   length: number,
//   ctx: EvaluationContext,
// ): OCTDate {
//   return unit === "MONTHS" ? addMonthsRule(d, length, ctx) : addDays(d, length);
// }

/** Generate raw cadence from start (no cliff yet), as a list of dates. */
// function generateCadence(
//   start: OCTDate,
//   p: VestingPeriod,
//   ctx: EvaluationContext,
// ): OCTDate[] {
//   const out: OCTDate[] = [];
//   let d = start;
//   for (let i = 0; i < p.occurrences; i++) {
//     out.push((d = nextDate(d, p.type, p.length, ctx)));
//   }
//   return out;
// }

/** Cliff catch-up: bundle all installments strictly before the cliff date into a single tranche on the cliff date. */
// function applyCliffCatchUp(cadence: OCTDate[], cliff: OCTDate): OCTDate[] {
//   let idx = 0;
//   while (idx < cadence.length && lt(cadence[idx], cliff)) idx++;
//   if (idx === 0) return cadence; // nothing before cliff
//   return [cliff, ...cadence.slice(idx)];
// }

/* ------------------------
 * Schedule selectors picked by vesting_start
 * ------------------------ */

/**
 * Choose which ScheduleExpr should apply be comparing resolved vesting_start dates.
 * - EARLIER_OF: pick earliest resolved start
 * - LATER_OF: pick latest resolved start (requires all resolved)
 */
export function pickScheduleByStart(
  items: ScheduleExpr[],
  ctx: EvaluationContext,
  mode: SelectorTag,
): PickedSchedule {
  let candidate: { schedule: NormalizedSchedule; start: OCTDate } | undefined;
  let unresolved = false;

  for (const item of items) {
    if (item.type !== "SINGLETON") {
      // Recurse into nested selectors
      const sub = pickScheduleByStart((item as any).items, ctx, item.type);
      if (!sub.chosen) {
        unresolved ||= sub.unresolved;
        continue;
      }
      const startDate = sub.vesting_start!;
      if (!candidate) candidate = { schedule: sub.chosen, start: startDate };
      else {
        const better =
          mode === "EARLIER_OF"
            ? lt(startDate, candidate.start)
            : lt(candidate.start, startDate);
        if (better) candidate = { schedule: sub.chosen, start: startDate };
      }
      continue;
    }

    const startRes = resolveNodeExpr(item.vesting_start, ctx);
    if (startRes.state === "inactive") continue; // ignore inactive
    if (startRes.state !== "resolved") {
      unresolved = true;
      continue;
    }

    if (!candidate) candidate = { schedule: item, start: startRes.date };
    else {
      const better =
        mode === "EARLIER_OF"
          ? lt(startRes.date, candidate.start)
          : lt(candidate.start, startRes.date);
      if (better) candidate = { schedule: item, start: startRes.date };
    }
  }

  if (!candidate) return { unresolved };
  return {
    chosen: candidate.schedule,
    vesting_start: candidate.start,
    unresolved,
  };
}

/* ------------------------
 * Plan builders
 * ------------------------ */

// function planFromSingleton(
//   expr: NormalizedSchedule,
//   ctx: EvaluationContext,
//   forcedStart?: OCTDate,
// ): Schedule {
//   const startRes = forcedStart
//     ? { state: "resolved" as const, date: forcedStart }
//     : resolveNodeExpr(expr.vesting_start, ctx);
//
//   if (startRes.state !== "resolved") {
//     return {
//       vesting_start: startRes,
//       cliff: expr.periodicity.cliff
//         ? {
//             input: resolveNodeExpr(expr.periodicity.cliff, ctx),
//             applied: false,
//           }
//         : undefined,
//       tranches: [],
//     };
//   }
//
//   // supple synthetic vestingStart event for cliff
//   ctx.events["vestingStart"] = startRes.date;
//
//   const cadence = generateCadence(startRes.date, expr.periodicity, ctx);
//   let finalDates = cadence;
//   let applied = false;
//
//   if (expr.periodicity.cliff) {
//     const cliffRes = resolveNodeExpr(expr.periodicity.cliff, ctx);
//     if (cliffRes.state !== "resolved") {
//       return {
//         vesting_start: startRes,
//         cliff: { input: cliffRes, applied: false },
//         tranches: [],
//       };
//     }
//     finalDates = applyCliffCatchUp(cadence, cliffRes.date);
//     applied = finalDates.length !== cadence.length;
//   }
//
//   // Even split across installments
//   const n = finalDates.length;
//   const amount = 1 / n;
//   const tranches: Tranche[] = finalDates.map((date) => ({ date, amount }));
//
//   return {
//     vesting_start: startRes,
//     cliff: expr.periodicity.cliff
//       ? { input: { state: "resolved", date: finalDates[0] }, applied }
//       : undefined,
//     tranches,
//   };
// }

/** Public: ScheduleExpr -> SchedulePlan (EARLIER/LATER pick by resolved vesting_start). */
// export function buildSchedulePlan(
//   expr: ScheduleExpr,
//   ctx: EvaluationContext,
// ): Schedule {
//   if (expr.type === "SINGLETON") return planFromSingleton(expr, ctx);
//
//   const picked = pickScheduleByStart(expr.items, ctx, expr.type);
//
//   // LATER requires all items resolved to select; EARLIER can proceed with any resolved candidate.
//   if (!picked.chosen)
//     return { vesting_start: { state: "unresolved" }, tranches: [] };
//
//   return planFromSingleton(picked.chosen, ctx, picked.start);
// }
