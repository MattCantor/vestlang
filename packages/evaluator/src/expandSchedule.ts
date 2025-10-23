import { OCTDate, ScheduleExpr } from "@vestlang/types";
import { resolveNodeExpr } from "./resolve.js";
import { pickScheduleByStart } from "./selectors.js";
import {
  EvaluationContext,
  ExpandedSchedule,
  PickedSchedule,
} from "./types.js";
import { nextDate } from "./time.js";

/**
 * Expand a ScheduleExpr into a concrete (or partially concrete) sequence of vesting tranches.
 */
export function expandSchedule(
  expr: ScheduleExpr,
  ctx: EvaluationContext,
): ExpandedSchedule {
  // Choose concrete schedule if selector
  const picked: PickedSchedule =
    expr.type === "SINGLETON"
      ? { chosen: expr, vesting_start: undefined, unresolved: false }
      : pickScheduleByStart(expr.items, ctx, expr.type);

  if (!picked.chosen) {
    return { vesting_start: { state: "unresolved" }, tranches: [] };
  }

  const sched = picked.chosen;
  const startRes = picked.vesting_start
    ? { state: "resolved" as const, date: picked.vesting_start }
    : resolveNodeExpr(sched.vesting_start, ctx);

  if (startRes.state !== "resolved") {
    return { vesting_start: startRes, tranches: [] };
  }

  // Generate cadence (no cliff yet)
  const cadence: OCTDate[] = [];
  let d = startRes.date;
  const { type, length, occurrences } = sched.periodicity;
  for (let i = 0; i < occurrences; i++) {
    cadence.push((d = nextDate(d, type, length, ctx)));
  }

  // Resolve cliff using overlay ctx
  let applied = false;
  let cliffField: ExpandedSchedule["cliff"] = undefined;

  if (sched.periodicity.cliff) {
    const overlayCtx: EvaluationContext = {
      ...ctx,
      events: { ...ctx.events, vestingStart: startRes.date },
    };
    const cliffRes = resolveNodeExpr(sched.periodicity.cliff, overlayCtx);

    if (cliffRes.state === "resolved") {
      // Catch-up: combine installments before the cliff into one tranche
      let idx = 0;
      while (idx < cadence.length && cadence[idx] < cliffRes.date) idx++;
      if (idx > 0) {
        cadence.splice(0, idx, cliffRes.date);
        applied = true;
      }
      cliffField = { input: cliffRes, applied };
    } else {
      cliffField = { input: cliffRes, applied: false };
    }
  }

  // Even split across installments
  // TODO: implement rounding here
  const n = cadence.length;
  const tranches = cadence.map((date) => ({
    date,
    amount: n > 0 ? 1 / n : 0,
  }));

  return { vesting_start: startRes, cliff: cliffField, tranches };
}
