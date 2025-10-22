import { Amount, Statement as NormalizedStatement } from "@vestlang/types";
import { EvaluationContext, Tranche } from "./types.js";
import { buildSchedulePlan } from "./schedule.js";

export interface VestedResult {
  vested: Tranche[];
  unvested: Tranche[];
  unresolved: number; // quantity not yet schedulable
}

function amountToQuantify(a: Amount, grantQuantity: number): number {
  return a.type === "QUANTITY"
    ? a.value
    : grantQuantity * (a.numerator / a.denominator);
}

export function evaluateStatementAsOf(
  stmt: NormalizedStatement,
  ctx: EvaluationContext,
): VestedResult {
  const plan = buildSchedulePlan(stmt.expr, ctx);
  const total = amountToQuantify(stmt.amount, ctx.grantQuantity);

  if (plan.tranches.length === 0) {
    return {
      vested: [],
      unvested: [],
      unresolved: total,
    };
  }

  const vested: Tranche[] = [];
  const unvested: Tranche[] = [];

  for (const t of plan.tranches) {
    const amt = total * t.amount;
    (t.date <= ctx.asOf ? vested : unvested).push({
      date: t.date,
      amount: amt,
    });
  }

  return { vested, unvested, unresolved: 0 };
}
