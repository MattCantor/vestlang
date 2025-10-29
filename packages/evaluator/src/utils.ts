import {
  EvaluationContext,
  EvaluationContextInput,
  LaterOfVestingNode,
  OCTDate,
  Statement,
} from "@vestlang/types";
import { lt } from "./time.js";
import { pickFromVestingNodeExpr } from "./selectors.js";
import { amountToQuantify } from "./allocation.js";

export function prepare(stmt: Statement, ctx_input: EvaluationContextInput) {
  const ctx = createEvaluationContext(ctx_input);
  const statementQuantity = amountToQuantify(stmt.amount, ctx.grantQuantity);
  if (statementQuantity % 1 !== 0 || statementQuantity < 0)
    throw new Error(
      `expandAllocatedSchedule: totalQuantity must be a positive whole number or zero: ${statementQuantity}`,
    );
  return { ctx, statementQuantity };
}

function createEvaluationContext(
  input: EvaluationContextInput,
): EvaluationContext {
  return {
    ...input,
    vesting_day_of_month:
      input.vesting_day_of_month ?? "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    allocation_type: input.allocation_type ?? "CUMULATIVE_ROUND_DOWN",
  };
}

/**
 * Catch-up: collapse all installments strictly before `floor` into one tranche on `floor`.
 */
export function catchUp(dates: readonly OCTDate[], floor: OCTDate): OCTDate[] {
  let idx = 0;
  while (idx < dates.length && lt(dates[idx], floor)) idx++;

  if (idx > 0) {
    // Replace all earlier installments with a single tranche at `floor`
    return [floor, ...dates.slice(idx)];
  }
  return [...dates];
}

/** Probe for latest resolved dates within a LATER OF */
export function probeLaterOf(
  expr: LaterOfVestingNode,
  ctx: EvaluationContext,
): OCTDate | undefined {
  const resolvedDates: OCTDate[] = [];

  for (const item of expr.items) {
    const res = pickFromVestingNodeExpr(item, ctx);
    if (res.type === "PICKED" && res.meta.type === "RESOLVED")
      resolvedDates.push(res.meta.date);
    continue;
  }

  if (resolvedDates.length === 0) return undefined;

  // latest of all resolved so far
  let latest = resolvedDates[0];
  for (let i = 1; i < resolvedDates.length; i++) {
    if (lt(latest, resolvedDates[i])) latest = resolvedDates[i];
  }

  return latest;
}
