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

// An integer share claim for a statement. A QUANTITY is its own count; a PORTION
// floors grant × fraction the same way the template arm does (one cumulative
// through floorSharesAt), so the symbolic and template arms agree on a statement's
// total — and the result is always integral, never a fractional BigInt input.
export function amountToQuantify(a: Amount, grantQuantity: number): number {
  return a.type === "QUANTITY"
    ? a.value
    : floorSharesAt(grantQuantity, {
        numerator: a.numerator,
        denominator: a.denominator,
      });
}
