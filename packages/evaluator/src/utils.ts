import {
  EvaluationContext,
  EvaluationContextInput,
  Statement,
} from "@vestlang/types";
import { amountClaim } from "./claims.js";

export function prepare(stmt: Statement, ctx_input: EvaluationContextInput) {
  const ctx = createEvaluationContext(ctx_input);
  const statementQuantity = amountClaim(stmt.amount, ctx.grantQuantity);
  return { ctx, statementQuantity };
}

export function createEvaluationContext(
  input: EvaluationContextInput,
): EvaluationContext {
  // Every evaluator entry funnels through here, so this is where the grant's
  // share count gets policed — the same safe-integer rule core's compile
  // applies to totalShares. Without it a bad grantQuantity travels all the way
  // to the allocation kernel and dies there with a kernel-flavored error.
  if (!Number.isSafeInteger(input.grantQuantity) || input.grantQuantity < 0) {
    throw new Error(
      `grantQuantity must be a non-negative safe integer (got ${input.grantQuantity})`,
    );
  }
  return {
    ...input,
    vesting_day_of_month:
      input.vesting_day_of_month ?? "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
  };
}
