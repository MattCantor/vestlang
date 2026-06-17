import type { ResolutionContext, OCTDate } from "@vestlang/types";
import { addMonthsRule as addMonthsRuleCore } from "@vestlang/core";

// Date math lives once, in @vestlang/core (dependency-free, UTC-safe stepping,
// exact ISO-string comparison). Everything — including the evaluator's own
// internals — imports those primitives straight from core. The one piece that
// can't be shared as-is is the day-of-month policy: core takes a plain
// VestingDayOfMonth, the evaluator carries it on its resolution context. This
// module exists only to adapt addMonthsRule across that seam.

/**
 * Step `months` calendar months, snapping to the day-of-month policy on the
 * context. This is the *cadence* stepper: the recurring grid and a cliff's own
 * `vestingStart` anchor land on the grant's vesting day, so a fixed "15" policy
 * pulls each month to the 15th. Displacement offsets must NOT use this — see
 * `addMonthsExact`.
 */
export const addMonthsRule = (
  iso: OCTDate,
  months: number,
  ctx: ResolutionContext,
): OCTDate => addMonthsRuleCore(iso, months, ctx.vesting_day_of_month);

/**
 * Step `months` calendar months as an exact duration: keep the day you started
 * on, clamping only where a shorter target month forces it (Jan 31 + 1mo → Feb
 * 28). This is the displacement stepper — a `FROM … + N months` offset or a
 * BEFORE/AFTER gate boundary is a duration, not a vesting date, so it never
 * consults the policy. It's core's `addMonthsRule` left on its default keep-day
 * rule (`origin` defaults to the stepped date), so no day-of-month is threaded.
 */
export const addMonthsExact = (iso: OCTDate, months: number): OCTDate =>
  addMonthsRuleCore(iso, months);
