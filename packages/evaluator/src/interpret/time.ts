import type { Offsets, ResolutionContext, OCTDate } from "@vestlang/types";
import {
  addDays,
  addMonthsRule as addMonthsRulePrimitive,
} from "@vestlang/primitives";

// Date math lives once, in @vestlang/primitives (dependency-free, UTC-safe
// stepping, exact ISO-string comparison). Everything — including the evaluator's
// own internals — imports those primitives straight from there. The one piece
// that can't be shared as-is is the day-of-month policy: the primitive takes a
// plain VestingDayOfMonth, the evaluator carries it on its resolution context.
// This module exists only to adapt addMonthsRule across that seam.

/**
 * Step `months` calendar months, snapping to the day-of-month policy on the
 * context. This is the *cadence* stepper: the recurring grid and a cliff's own
 * `vestingStart` anchor land on the grant's vesting day, so e.g. a
 * `LAST_DAY_OF_MONTH` policy pulls each month to its month-end. Displacement
 * offsets must NOT use this — see `addMonthsExact`.
 */
export const addMonthsRule = (
  iso: OCTDate,
  months: number,
  ctx: ResolutionContext,
): OCTDate => addMonthsRulePrimitive(iso, months, ctx.vesting_day_of_month);

/**
 * Step `months` calendar months as an exact duration: keep the day you started
 * on, clamping only where a shorter target month forces it (Jan 31 + 1mo → Feb
 * 28). This is the displacement stepper — a `FROM … + N months` offset or a
 * BEFORE/AFTER gate boundary is a duration, not a vesting date, so it never
 * consults the policy. It's core's `addMonthsRule` left on its default keep-day
 * rule (`origin` defaults to the stepped date), so no day-of-month is threaded.
 */
export const addMonthsExact = (iso: OCTDate, months: number): OCTDate =>
  addMonthsRulePrimitive(iso, months);

/**
 * Walk an offset list onto a date. A DAYS offset is the same exact calendar step
 * everywhere; a MONTHS offset is stepped by `monthStep` — the caller passes the
 * cadence stepper (`addMonthsRule`, policy-aware) or the exact one (`addMonthsExact`),
 * so this loop never reads the day-of-month policy itself. `negate` flips every
 * offset's sign, which inverts the whole displacement: it's how the disclosure path
 * recovers the boundary a *raw* event firing flips at from a gated-event offset (the
 * negation of `EVENT ipo - 6 months` shifts the subject date `+6 months`). The
 * forward walk and its negated inverse are the same step modulo sign, so they live
 * here once rather than in two near-identical loops.
 */
export const stepByOffsets = (
  base: OCTDate,
  offsets: Offsets,
  monthStep: (d: OCTDate, n: number) => OCTDate,
  negate = false,
): OCTDate => {
  let d = base;
  for (const o of offsets) {
    const magnitude = o.sign === "PLUS" ? o.value : -o.value;
    const signed = negate ? -magnitude : magnitude;
    d = o.unit === "MONTHS" ? monthStep(d, signed) : addDays(d, signed);
  }
  return d;
};
