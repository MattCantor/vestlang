import {
  ScheduleExpr,
  PeriodTag,
  VestingPeriod,
  OCTDate,
  Schedule as NormalizedSchedule,
} from "@vestlang/types";
import { EvaluationContext, Schedule, Tranche } from "./types.js";
import { resolveNodeExpr } from "./resolve.js";
import { addMonthsRule, addDays, lt } from "./time.js";

/* ------------------------
 * Cadence helpers
 * ------------------------ */

function nextDate(d: OCTDate, unit: PeriodTag, length: number): OCTDate {
  return unit === "MONTHS" ? addMonthsRule(d, length) : addDays(d, length);
}

/** Generate raw cadence from start (no cliff yet), as a list of dates. */
function generateCadence(start: OCTDate, p: VestingPeriod): OCTDate[] {
  const out: OCTDate[] = [];
  let d = start;
  for (let i = 0; i < p.occurrences; i++) {
    out.push(i === 0 ? d : (d = nextDate(d, p.type, p.length)));
  }
  return out;
}

/** Cliff catch-up: bundle all installments strictly before the cliff date into a single tranche on the cliff date. */
function applyCliffCatchUp(cadence: OCTDate[], cliff: OCTDate): OCTDate[] {
  let idx = 0;
  while (idx < cadence.length && lt(cadence[idx], cliff)) idx++;
  if (idx === 0) return cadence; // nothing before cliff
  return [cliff, ...cadence.slice(idx)];
}

/* ------------------------
 * Schedule selectors picked by vesting_start
 * ------------------------ */

type Picked = {
  chosen?: NormalizedSchedule;
  start?: OCTDate;
  unresolved: boolean;
};

function pickScheduleByStart(
  items: ScheduleExpr[],
  ctx: EvaluationContext,
  mode: "EARLIER" | "LATER",
): Picked {
  let candidate: { s: NormalizedSchedule; start: OCTDate } | undefined;
  let unresolved = false;

  for (const it of items) {
    if (it.type !== "SINGLETON") {
      // Recurse into nested selectors
      const sub = pickScheduleByStart(
        (it as any).items,
        ctx,
        it.type === "EARLIER_OF" ? "EARLIER" : "LATER",
      );
      if (!sub.chosen) {
        unresolved = unresolved || sub.unresolved;
        continue;
      }
      const d = sub.start!;
      if (!candidate) candidate = { s: sub.chosen, start: d };
      else {
        const better =
          mode === "EARLIER" ? lt(d, candidate.start) : lt(candidate.start, d);
        if (better) candidate = { s: sub.chosen, start: d };
      }
      continue;
    }

    const startRes = resolveNodeExpr(it.vesting_start, ctx);
    if (startRes.state === "inactive") continue; // ignore inactive
    if (startRes.state !== "resolved") {
      unresolved = true;
      continue;
    }

    if (!candidate) candidate = { s: it, start: startRes.date };
    else {
      const better =
        mode === "EARLIER"
          ? lt(startRes.date, candidate.start)
          : lt(candidate.start, startRes.date);
      if (better) candidate = { s: it, start: startRes.date };
    }
  }

  if (!candidate) return { unresolved };
  return { chosen: candidate.s, start: candidate.start, unresolved };
}

/* ------------------------
 * Plan builders
 * ------------------------ */

function planFromSingleton(
  expr: NormalizedSchedule,
  ctx: EvaluationContext,
  forcedStart?: OCTDate,
): Schedule {
  const startRes = forcedStart
    ? { state: "resolved" as const, date: forcedStart }
    : resolveNodeExpr(expr.vesting_start, ctx);

  if (startRes.state !== "resolved") {
    return {
      vesting_start: startRes,
      cliff: expr.periodicity.cliff
        ? {
            input: resolveNodeExpr(expr.periodicity.cliff, ctx),
            applied: false,
          }
        : undefined,
      tranches: [],
    };
  }

  const cadence = generateCadence(startRes.date, expr.periodicity);
  let finalDates = cadence;
  let applied = false;

  if (expr.periodicity.cliff) {
    const cliffRes = resolveNodeExpr(expr.periodicity.cliff, ctx);
    if (cliffRes.state !== "resolved") {
      return {
        vesting_start: startRes,
        cliff: { input: cliffRes, applied: false },
        tranches: [],
      };
    }
    finalDates = applyCliffCatchUp(cadence, cliffRes.date);
    applied = finalDates.length !== cadence.length;
  }

  // Even split across installments
  const n = finalDates.length;
  const amount = 1 / n;
  const tranches: Tranche[] = finalDates.map((date) => ({ date, amount }));

  return {
    vesting_start: startRes,
    cliff: expr.periodicity.cliff
      ? { input: { state: "resolved", date: finalDates[0] }, applied }
      : undefined,
    tranches,
  };
}

/** Public: ScheduleExpr -> SchedulePlan (EARLIER/LATER pick by resolved vesting_start). */
export function buildSchedulePlan(
  expr: ScheduleExpr,
  ctx: EvaluationContext,
): Schedule {
  if (expr.type === "SINGLETON") return planFromSingleton(expr, ctx);

  const mode = expr.type === "EARLIER_OF" ? "EARLIER" : "LATER";
  const picked = pickScheduleByStart(expr.items, ctx, mode);

  // LATER requires all items resolved to select; EARLIER can proceed with any resolved candidate.
  if (!picked.chosen)
    return { vesting_start: { state: "unresolved" }, tranches: [] };

  return planFromSingleton(picked.chosen, ctx, picked.start);
}
