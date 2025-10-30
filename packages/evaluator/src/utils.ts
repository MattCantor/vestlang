import {
  Amount,
  EvaluationContext,
  EvaluationContextInput,
  Statement,
} from "@vestlang/types";

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

export function amountToQuantify(a: Amount, grantQuantity: number): number {
  return a.type === "QUANTITY"
    ? a.value
    : grantQuantity * (a.numerator / a.denominator);
}
