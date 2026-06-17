// Resolve a vestlang offset expression (`EVENT ipo + 6 months`, `+3 months`,
// `DATE 2025-01-01 - 2 days`) to a concrete date. Like the other run* entries it
// owns the whole chain — parse → buildContext → resolve → shape — so the app never
// hand-assembles a context. The pure date math the date-math tools call directly
// (addPeriod / dateDiff / resolveVestingDay) stays in the MCP app; only this
// evaluate-backed resolution moved here.

import { resolveVestingStart } from "@vestlang/evaluator";
import type { OCTDate, VestingDayOfMonth } from "@vestlang/types";
import { parseToProgram, type Result } from "./parse.js";
import { buildContext } from "./context.js";

export interface ResolveOffsetInput {
  expr: string;
  grant_date: OCTDate;
  events?: Record<string, OCTDate>;
  vesting_day_of_month?: VestingDayOfMonth;
}

export type ResolveOffsetResult = Result<{ date: OCTDate }>;

/**
 * Resolve an offset expression (e.g. "EVENT ipo + 6 months", "+3 months",
 * "DATE 2025-01-01 - 2 days") to a concrete date.
 *
 * The expression is wrapped as `VEST FROM <expr>` so the full DSL parser and
 * normalizer run over it, then its parsed anchor is resolved DIRECTLY via the
 * evaluator's `resolveVestingStart` — no allocation, no installments, and crucially
 * no grant-date payment fold (which is the allocation path's, and would wrongly
 * raise any pre-grant date up to grant_date). No observation date enters: resolving
 * a start reads structural state, the same whenever you ask, so there's nothing to
 * be "as of."
 *
 * The contract is a single offset expression. A `THEN` tail or a `PLUS` fan-out
 * parses to more than one statement; both used to silently resolve to the first
 * head's start and drop the rest, so they're refused rather than truncated.
 */
export function runResolveOffset(
  input: ResolveOffsetInput,
): ResolveOffsetResult {
  const parsed = parseToProgram(`VEST FROM ${input.expr}`);
  if (!parsed.ok) {
    // Rewrap, don't propagate: the parser ran over the synthetic `VEST FROM
    // <expr>` wrap, so its `loc` is column-shifted by the 10-char prefix and
    // points at source the user never typed. Keep the message (prefixed for
    // context) and drop the loc rather than report a misleading span.
    return {
      ok: false,
      error: {
        ruleId: "syntax-error",
        message: `Could not parse expression: ${parsed.error.message}`,
      },
    };
  }
  const program = parsed.program;

  // A single offset expression is exactly one statement. Anything else is a
  // multi-statement input (a THEN tail or a PLUS fan-out) the tool can't honor —
  // reading program[0] would silently drop the rest.
  if (program.length !== 1) {
    return {
      ok: false,
      error: {
        ruleId: "offset-not-single-expression",
        message:
          program.length === 0
            ? "Expression produced no statements"
            : `Expected a single offset expression, got ${program.length} statements`,
      },
    };
  }

  const stmt = program[0];
  // A `VEST FROM <expr>` head is never a chained tail; the guard is what lets us
  // read a non-null `vesting_start` off the schedule below.
  if (stmt.chained || stmt.expr.type !== "SCHEDULE") {
    return {
      ok: false,
      error: {
        ruleId: "offset-not-single-expression",
        message: "Expected a single offset expression, got a selector",
      },
    };
  }

  // vesting_day_of_month is passed through, not re-defaulted here: the evaluator
  // coalesces it against the same DEFAULT_VESTING_DAY_OF_MONTH (evaluator
  // createEvaluationContext), so an unset rule lands on the identical default.
  // grant_quantity is an unused placeholder — resolution reads no allocation, so
  // the share count is never consumed, but ResolutionContextInput requires it and
  // createEvaluationContext validates it.
  const ctx = buildContext({
    grant_date: input.grant_date,
    events: input.events,
    grant_quantity: 1,
    vesting_day_of_month: input.vesting_day_of_month,
  });

  // No try/catch: a range/overflow RangeError from the date arithmetic (e.g.
  // `+100000000 days`) must propagate and throw, the same as everywhere else.
  const result = resolveVestingStart(stmt.expr.vesting_start, ctx);
  if (result.resolved) {
    return { ok: true, date: result.date };
  }

  return {
    ok: false,
    error: {
      ruleId: "offset-unresolved",
      message: `Expression is unresolved: ${result.reason}`,
      unresolved: result.reason,
    },
  };
}
