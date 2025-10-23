import { Statement as NormalizedStatement } from "@vestlang/types";
import { EvaluationContextInput, Tranche } from "./types.js";
import { expandAllocatedSchedule } from "./expandSchedule.js";
import { createEvaluationContext } from "./utils.js";
import { amountToQuantify } from "./allocation.js";

export interface VestedResult {
  vested: Tranche[];
  unvested: Tranche[];
  unresolved: number; // quantity not yet schedulable
}

/**
 * Evaluate a normallized Statement as of a given date.
 * Expands the schedule, converts amount -> quantity, and splits tranches
 */
export function evaluateStatementAsOf(
  stmt: NormalizedStatement,
  ctx_input: EvaluationContextInput,
): VestedResult {
  const ctx = createEvaluationContext(ctx_input);
  const total = amountToQuantify(stmt.amount, ctx.grantQuantity);

  const allocated = expandAllocatedSchedule(stmt.expr, ctx, stmt.amount, total);

  const vested: Tranche[] = [];
  const unvested: Tranche[] = [];

  if (
    allocated.tranches.length === 0 ||
    allocated.vesting_start.state !== "resolved"
  ) {
    return {
      vested,
      unvested,
      unresolved: Math.round(total),
    };
  }

  for (const t of allocated.tranches) {
    (t.date <= ctx.asOf ? vested : unvested).push({
      date: t.date,
      amount: t.amount,
    });
  }

  return { vested, unvested, unresolved: allocated.unresolved };
}
