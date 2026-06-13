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
  return {
    ...input,
    vesting_day_of_month:
      input.vesting_day_of_month ?? "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
  };
}
