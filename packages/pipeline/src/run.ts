// The orchestrators. Each takes a grant's raw scalars plus the DSL, runs the
// whole chain (parse → build context → evaluate → shape), and hands back either
// a display-ready result or one PipelineError. An app calling these never owns
// the sequence, so it can't skip a step or drop an argument; all it adds is the
// per-statement index and the rendering.
//
// The signatures deliberately differ — an "as of" date only appears where it
// means something. Don't fold them back into one ctx argument.

import {
  evaluateStatements,
  evaluateStatementsAsOf,
  toScheduleView,
  type ScheduleView,
} from "@vestlang/evaluator";
import { evaluateProgramWithRecovery } from "@vestlang/recover";
import type { Installment, OCTDate, VestingDayOfMonth } from "@vestlang/types";
import { parseToProgram, toEvaluationError, type Result } from "./parse.js";
import { buildContext } from "./context.js";
import { computeSummary, filterByWindow, type Summary } from "./summary.js";

// The grant a schedule is evaluated against. `events.grantDate` is injected by
// the context builder, so callers pass only their own named events.
export type GrantInput = {
  grant_date: OCTDate;
  grant_quantity: number;
  events?: Record<string, OCTDate>;
  vesting_day_of_month?: VestingDayOfMonth;
};

// What an events-only program carries after it's been rescued back to a
// template: where it came from and the inferred DSL. The compiled template and
// runtime stay server-side and aren't surfaced here.
export type RecoveredView = {
  from: "events-only";
  reason: string;
  dsl: string;
  vestingDayOfMonth: VestingDayOfMonth;
  residualError: number;
};

// One statement's point-in-time partition, plus the roll-up.
export type AsOfView = {
  vested: Installment[];
  unvested: Installment[];
  impossible: Installment[];
  unresolved: number;
  summary: Summary;
};

// One statement's resolved tranches inside a [from, to] window.
export type WindowView = {
  vested_in_window: number;
  tranches_in_window: number;
  installments: Installment[];
};

// Every installment for every statement, each statement classified on its own.
export function runEvaluate(
  dsl: string,
  g: GrantInput,
): Result<{ views: ScheduleView[] }> {
  const parsed = parseToProgram(dsl);
  if (!parsed.ok) return parsed;
  const ctx = buildContext(g);
  try {
    const schedules = evaluateStatements(parsed.program, ctx);
    return { ok: true, views: schedules.map(toScheduleView) };
  } catch (err) {
    return { ok: false, error: toEvaluationError(err) };
  }
}

// The whole program collapsed into one schedule, with the program-level verdict.
// Runs template recovery: an events-only program whose realized projection has a
// single-template form is rescued back to a template, transparently.
export function runEvaluateProgram(
  dsl: string,
  g: GrantInput,
): Result<{ view: ScheduleView; recovered?: RecoveredView }> {
  const parsed = parseToProgram(dsl);
  if (!parsed.ok) return parsed;
  const ctx = buildContext(g);
  try {
    const outcome = evaluateProgramWithRecovery(parsed.program, ctx);
    const view = toScheduleView(outcome.schedule);
    if (outcome.rescued) {
      const r = outcome.recovered;
      return {
        ok: true,
        view,
        recovered: {
          from: r.from,
          reason: r.reason,
          dsl: r.dsl,
          vestingDayOfMonth: r.vestingDayOfMonth,
          residualError: r.residualError,
        },
      };
    }
    return { ok: true, view };
  } catch (err) {
    return { ok: false, error: toEvaluationError(err) };
  }
}

// Point-in-time view: each statement partitioned into vested/unvested/impossible
// as of `asOf` (defaulting to today), with a summary.
export function runAsOf(
  dsl: string,
  g: GrantInput,
  asOf?: OCTDate,
): Result<{ asOf: OCTDate; statements: AsOfView[] }> {
  const parsed = parseToProgram(dsl);
  if (!parsed.ok) return parsed;
  const ctx = buildContext({ ...g, as_of: asOf });
  try {
    const results = evaluateStatementsAsOf(parsed.program, ctx);
    return {
      ok: true,
      asOf: ctx.asOf,
      statements: results.map((r) => ({
        vested: r.vested,
        unvested: r.unvested,
        impossible: r.impossible,
        unresolved: r.unresolved,
        summary: computeSummary(r, ctx.grantQuantity),
      })),
    };
  } catch (err) {
    return { ok: false, error: toEvaluationError(err) };
  }
}

// Resolved tranches whose vest date falls within [from, to], inclusive. The
// cutoff is `to`, so there's no separate as-of to pass. Owns the ordering check.
export function runVestedBetween(
  dsl: string,
  g: GrantInput,
  from: OCTDate,
  to: OCTDate,
): Result<{ from: OCTDate; to: OCTDate; statements: WindowView[] }> {
  if (from > to) {
    return {
      ok: false,
      error: {
        ruleId: "evaluation-error",
        message: `Invalid window: from (${from}) is after to (${to})`,
      },
    };
  }
  const parsed = parseToProgram(dsl);
  if (!parsed.ok) return parsed;
  const ctx = buildContext({ ...g, as_of: to });
  try {
    const results = evaluateStatementsAsOf(parsed.program, ctx);
    return {
      ok: true,
      from,
      to,
      statements: results.map((r) => {
        const { installments, total } = filterByWindow(r.vested, from, to);
        return {
          vested_in_window: total,
          tranches_in_window: installments.length,
          installments,
        };
      }),
    };
  } catch (err) {
    return { ok: false, error: toEvaluationError(err) };
  }
}
