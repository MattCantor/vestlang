import {
  Statement as NormalizedStatement,
  allocation_type,
} from "@vestlang/types";
import { EvaluationContextInput, Tranche } from "./types.js";
import { expandSchedule } from "./expandSchedule.js";
import { createEvaluationContext } from "./utils.js";
import { amountToQuantify, allocateQuantity } from "./allocation.js";

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
  allocation_mode: allocation_type = "CUMULATIVE_ROUND_DOWN",
): VestedResult {
  const ctx = createEvaluationContext(ctx_input);
  const expanded = expandSchedule(stmt.expr, ctx);
  const total = amountToQuantify(stmt.amount, ctx.grantQuantity);

  if (
    expanded.tranches.length === 0 ||
    expanded.vesting_start.state !== "resolved"
  ) {
    return {
      vested: [],
      unvested: [],
      unresolved: total,
    };
  }

  const vested: Tranche[] = [];
  const unvested: Tranche[] = [];
  const allocations = allocateQuantity(
    total,
    expanded.tranches.length,
    allocation_mode,
  );

  for (let i = 0; i < expanded.tranches.length; i++) {
    const date = expanded.tranches[i].date;
    const amount = allocations[i];
    (date <= ctx.asOf ? vested : unvested).push({
      date,
      amount,
    });
  }

  return { vested, unvested, unresolved: 0 };
}
