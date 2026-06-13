import {
  Amount,
  EvaluationContext,
  EvaluationContextInput,
  Statement,
} from "@vestlang/types";
import { floorSharesAt } from "@vestlang/core";

export function prepare(stmt: Statement, ctx_input: EvaluationContextInput) {
  const ctx = createEvaluationContext(ctx_input);
  const statementQuantity = amountToQuantify(stmt.amount, ctx.grantQuantity);
  return { ctx, statementQuantity };
}

export function createEvaluationContext(
  input: EvaluationContextInput,
): EvaluationContext {
  return {
    ...input,
    vesting_day_of_month:
      input.vesting_day_of_month ?? "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
  };
}

// An integer share claim for a statement, never exceeding the grant. A PORTION
// floors grant × fraction the same way the template arm does (one cumulative
// through floorSharesAt), so the symbolic and template arms agree on a
// statement's total — and the result is always integral, never a fractional
// BigInt input. A QUANTITY is its own count, capped at the grant: the claim
// feeds surfaces with no findings channel (the as-of partition, the symbolic
// lumps), so an over-grant author — 150 VEST on a 100-share grant — must not
// read back as 150 shares still coming. The over-allocation finding owns that
// fact; the claim reports the most the grant could deliver. A zero-share grant
// caps every claim to 0, the integer twin of amountToFraction's ZERO clamp.
export function amountToQuantify(a: Amount, grantQuantity: number): number {
  return a.type === "QUANTITY"
    ? Math.min(a.value, grantQuantity)
    : floorSharesAt(grantQuantity, {
        numerator: a.numerator,
        denominator: a.denominator,
      });
}
