import type { ResolutionContext, OCTDate } from "@vestlang/types";
import { addMonthsRule as addMonthsRuleCore } from "@vestlang/core";

// Date math lives once, in @vestlang/core (dependency-free, UTC-safe stepping,
// exact ISO-string comparison). Everything — including the evaluator's own
// internals — imports those primitives straight from core. The one piece that
// can't be shared as-is is the day-of-month policy: core takes a plain
// VestingDayOfMonth, the evaluator carries it on its resolution context. This
// module exists only to adapt addMonthsRule across that seam.

/** Step `months` calendar months, reading the day-of-month policy off the context. */
export const addMonthsRule = (
  iso: OCTDate,
  months: number,
  ctx: ResolutionContext,
): OCTDate => addMonthsRuleCore(iso, months, ctx.vesting_day_of_month);
