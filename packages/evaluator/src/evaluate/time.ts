import type { EvaluationContext, OCTDate } from "@vestlang/types";
import { addMonthsRule as addMonthsRuleCore } from "@vestlang/core";

// Date math lives once, in @vestlang/core: dependency-free, UTC-safe stepping,
// and exact ISO-string comparison (zero-padded YYYY-MM-DD sorts as calendar
// order). This module re-exports those primitives so the evaluator shares the
// single implementation, and adapts addMonthsRule to the evaluator's
// EvaluationContext.
export { toDate, toISO, addDays, lt, gt, eq } from "@vestlang/core";

/** Step `months` calendar months, reading the day-of-month policy off the context. */
export const addMonthsRule = (
  iso: OCTDate,
  months: number,
  ctx: EvaluationContext,
): OCTDate => addMonthsRuleCore(iso, months, ctx.vesting_day_of_month);
