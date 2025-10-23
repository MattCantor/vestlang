import { Amount, OCTDate, ScheduleExpr } from "@vestlang/types";
import { resolveNodeExpr } from "./resolve.js";
import { pickScheduleByStart } from "./selectors.js";
import {
  AllocatedSchedule,
  EvaluationContext,
  ExpandedSchedule,
  PickedSchedule,
} from "./types.js";
import { nextDate } from "./time.js";
import { allocateQuantity, amountToQuantify } from "./allocation.js";

/**
 * Expand a ScheduleExpr into a concrete (or partially concrete) sequence of vesting dates.
 */
function expandSchedule(
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

  // resolve start
  const startRes = picked.vesting_start
    ? { state: "resolved" as const, date: picked.vesting_start }
    : resolveNodeExpr(sched.vesting_start, ctx);

  if (startRes.state !== "resolved") {
    return { vesting_start: startRes, tranches: [] };
  }

  // Generate cadence (first installment at start + 1 period)
  const dates: OCTDate[] = [];
  let d = startRes.date;
  const { type, length, occurrences } = sched.periodicity;
  for (let i = 0; i < occurrences; i++) {
    d = nextDate(d, type, length, ctx);
    dates.push(d);
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
      while (idx < dates.length && dates[idx] < cliffRes.date) idx++;
      if (idx > 0) {
        dates.splice(0, idx, cliffRes.date);
        applied = true;
      }
      cliffField = { input: cliffRes, applied };
    } else {
      cliffField = { input: cliffRes, applied: false };
    }
  }

  return {
    vesting_start: startRes,
    cliff: cliffField,
    tranches: dates.map((date) => ({ date })),
  };
}

/** Expand a ScheduleExpr and allocate integer shares accross its tranches.
 * Returns tranches with concrete amount and an 'unresolved' remainder (should be 0).
 */
export function expandAllocatedSchedule(
  expr: ScheduleExpr,
  ctx: EvaluationContext,
  amount: Amount,
  totalQuantity: number,
): AllocatedSchedule {
  const quantity = amountToQuantify(amount, totalQuantity);
  if (quantity % 1 !== 0 || quantity < 0)
    throw new Error(
      `expandAllocatedSchedule: totalQuantity must be a positive whole number or zero: ${totalQuantity}`,
    );
  const expanded = expandSchedule(expr, ctx);

  if (
    expanded.vesting_start.state !== "resolved" ||
    expanded.tranches.length === 0
  ) {
    return {
      vesting_start: expanded.vesting_start,
      cliff: expanded.cliff,
      tranches: [],
      unresolved: quantity,
    };
  }

  const n = expanded.tranches.length;
  const splits = allocateQuantity(quantity, n, ctx.allocation_type);
  const scheduled = splits.reduce((a, b) => a + b, 0);
  const remainder = quantity - scheduled;

  return {
    vesting_start: expanded.vesting_start,
    cliff: expanded.cliff,
    tranches: expanded.tranches.map((tranche, i) => ({
      date: tranche.date,
      amount: splits[i],
    })),
    unresolved: remainder < 0 ? 0 : remainder,
  };
}
