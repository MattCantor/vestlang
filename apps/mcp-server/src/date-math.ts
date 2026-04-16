import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import {
  addDays,
  addMonthsRule,
  evaluateStatement,
  toDate,
} from "@vestlang/evaluator";
import type {
  EvaluationContext,
  EvaluationContextInput,
  OCTDate,
  vesting_day_of_month,
} from "@vestlang/types";

export type PeriodUnit = "days" | "weeks" | "months" | "years";

const MS_PER_DAY = 86_400_000;

function stubCtx(rule: vesting_day_of_month): EvaluationContext {
  return {
    events: { grantDate: "1970-01-01" as OCTDate },
    grantQuantity: 0,
    asOf: "1970-01-01" as OCTDate,
    vesting_day_of_month: rule,
    allocation_type: "CUMULATIVE_ROUND_DOWN",
  };
}

export function addPeriod(
  date: OCTDate,
  length: number,
  unit: PeriodUnit,
  rule: vesting_day_of_month,
): OCTDate {
  switch (unit) {
    case "days":
      return addDays(date, length);
    case "weeks":
      return addDays(date, length * 7);
    case "months":
      return addMonthsRule(date, length, stubCtx(rule));
    case "years":
      return addMonthsRule(date, length * 12, stubCtx(rule));
  }
}

export function dateDiff(
  from: OCTDate,
  to: OCTDate,
  unit: "days" | "months",
): { diff: number; remainder_days?: number } {
  const f = toDate(from);
  const t = toDate(to);
  if (unit === "days") {
    const diff = Math.floor((t.getTime() - f.getTime()) / MS_PER_DAY);
    return { diff };
  }

  // Calendar months between (fy, fm, fd) and (ty, tm, td).
  // If td < fd, we haven't completed the final month yet — decrement.
  const fy = f.getUTCFullYear();
  const fm = f.getUTCMonth();
  const fd = f.getUTCDate();
  const ty = t.getUTCFullYear();
  const tm = t.getUTCMonth();
  const td = t.getUTCDate();

  const direction = t.getTime() >= f.getTime() ? 1 : -1;
  let monthsBetween = (ty - fy) * 12 + (tm - fm);
  if (direction === 1 && td < fd) monthsBetween -= 1;
  if (direction === -1 && td > fd) monthsBetween += 1;

  // Remainder days: from (from + monthsBetween months, clamped to end-of-month) to to.
  // Use the VESTING_START_DAY rule so the intermediate date keeps from's day when possible.
  const anchor = addMonthsRule(
    from,
    monthsBetween,
    stubCtx("VESTING_START_DAY_OR_LAST_DAY_OF_MONTH"),
  );
  const remainder_days = Math.floor(
    (t.getTime() - toDate(anchor).getTime()) / MS_PER_DAY,
  );

  return { diff: monthsBetween, remainder_days };
}

export interface ResolveOffsetInput {
  expr: string;
  grant_date: OCTDate;
  events?: Record<string, OCTDate>;
  vesting_day_of_month?: vesting_day_of_month;
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
 * offset arithmetic all flow through the single source of truth.
 */
export function resolveOffset(input: ResolveOffsetInput): ResolveOffsetResult {
  const dsl = `VEST FROM ${input.expr}`;
  let program;
  try {
    program = normalizeProgram(parse(dsl));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not parse expression: ${msg}` };
  }

  if (program.length === 0) {
    return { ok: false, error: "Expression produced no statements" };
  }

  const events: Record<string, OCTDate> = { grantDate: input.grant_date };
  for (const [k, v] of Object.entries(input.events ?? {})) events[k] = v;

  const ctx: EvaluationContextInput = {
    events: events as EvaluationContextInput["events"],
    grantQuantity: 1,
    asOf: "9999-12-31" as OCTDate,
    vesting_day_of_month:
      input.vesting_day_of_month ?? "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    allocation_type: "CUMULATIVE_ROUND_DOWN",
  };

  const { installments, blockers } = evaluateStatement(program[0]!, ctx);
  const first = installments[0] ?? null;

  if (first?.meta.state === "RESOLVED" && first.date) {
    return { ok: true, date: first.date };
  }

  const unresolvedReason =
    first?.meta.unresolved ?? blockerSummary(blockers) ?? "missing anchor";
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

/**
 * Resolve a date under a vesting_day_of_month rule, without crossing months.
 * Equivalent to `addMonthsRule(date, 0, { vesting_day_of_month: rule })`:
 * keeps year+month fixed and applies the rule's day-picker for that month.
 */
export function resolveVestingDay(
  date: OCTDate,
  rule: vesting_day_of_month,
): OCTDate {
  return addMonthsRule(date, 0, stubCtx(rule));
}
