import { EvaluationContext, EvaluationContextInput } from "./types.js";

export function createEvaluationContext(
  input: EvaluationContextInput,
): EvaluationContext {
  return {
    ...input,
    vesting_day_of_month:
      input.vesting_day_of_month ?? "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
  };
}
