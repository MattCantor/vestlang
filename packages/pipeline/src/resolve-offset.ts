// Resolve a vestlang offset expression (`EVENT ipo + 6 months`, `+3 months`,
// `DATE 2025-01-01 - 2 days`) to a concrete date. Like the other run* entries it
// owns the whole chain — parse → buildContext → evaluate → shape — so the app never
// hand-assembles a context. The pure date math the date-math tools call directly
// (addPeriod / dateDiff / resolveVestingDay) stays in the MCP app; only this
// evaluate-backed resolution moved here.

import { evaluateStatement } from "@vestlang/evaluator";
import type { OCTDate, VestingDayOfMonth } from "@vestlang/types";
import { parseToProgram } from "./parse.js";
import { buildContext } from "./context.js";

export interface ResolveOffsetInput {
  expr: string;
  grant_date: OCTDate;
  events?: Record<string, OCTDate>;
  vesting_day_of_month?: VestingDayOfMonth;
}

export type ResolveOffsetResult =
  | { ok: true; date: OCTDate }
  | { ok: false; error: string; unresolved?: string };

/**
 * Resolve an offset expression (e.g. "EVENT ipo + 6 months", "+3 months",
 * "DATE 2025-01-01 - 2 days") to a concrete date.
 *
 * Implemented by wrapping the expression as `VEST FROM <expr>` — a zero-length
 * schedule whose sole installment's date is the resolved start. This reuses
 * the full DSL parser and evaluator so day-of-month rules, event lookup, and
 * offset arithmetic all flow through the single source of truth. No observation
 * date enters: resolving the start reads the schedule's structural installment
 * state, which is the same whenever you ask, so there is nothing to be "as of."
 */
export function runResolveOffset(
  input: ResolveOffsetInput,
): ResolveOffsetResult {
  const parsed = parseToProgram(`VEST FROM ${input.expr}`);
  if (!parsed.ok) {
    return {
      ok: false,
      error: `Could not parse expression: ${parsed.error.message}`,
    };
  }
  const program = parsed.program;

  if (program.length === 0) {
    return { ok: false, error: "Expression produced no statements" };
  }

  // vesting_day_of_month is passed through, not re-defaulted here: the evaluator
  // coalesces it against the same DEFAULT_VESTING_DAY_OF_MONTH (evaluator
  // createEvaluationContext), so an unset rule lands on the identical default.
  const ctx = buildContext({
    grant_date: input.grant_date,
    events: input.events,
    grant_quantity: 1,
    vesting_day_of_month: input.vesting_day_of_month,
  });

  const { installments, pending, dead } = evaluateStatement(
    program[0],
    ctx,
  ).resolution;
  const first = installments[0] ?? null;

  if (first?.state === "RESOLVED") {
    return { ok: true, date: first.date };
  }

  // A date-math expression is one statement, so its hold-up is whatever's still
  // pending or already dead — summarize across both for the error message.
  const unresolvedReason =
    first?.unresolved ??
    blockerSummary([...pending, ...dead]) ??
    "missing anchor";
  return {
    ok: false,
    error: `Expression is unresolved: ${unresolvedReason}`,
    unresolved: unresolvedReason,
  };
}

function blockerSummary(blockers: unknown[]): string | null {
  if (blockers.length === 0) return null;
  const events: string[] = [];
  for (const b of blockers) {
    const bb = b as { type?: string; event?: string };
    if (bb.type === "EVENT_NOT_YET_OCCURRED" && bb.event) {
      events.push(bb.event);
    }
  }
  if (events.length > 0) {
    return `event(s) not provided: ${events.join(", ")}`;
  }
  return "expression not fully resolvable";
}
