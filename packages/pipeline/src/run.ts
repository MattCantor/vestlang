// The orchestrators. Each takes a grant's raw scalars plus the DSL, runs the
// whole chain (parse → build context → evaluate → shape), and hands back either
// a display-ready result or one PipelineError. An app calling these never owns
// the sequence, so it can't skip a step or drop an argument; all it adds is the
// per-statement index and the rendering.
//
// The signatures deliberately differ — an "as of" date only appears where it
// means something. Don't fold them back into one ctx argument.

import { evaluateProgramAsOf, evaluateClauseGroups } from "@vestlang/evaluator";
import { toScheduleView, reasonToString, type ScheduleView } from "./view.js";
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

// The whole grant's point-in-time partition, plus the roll-up.
export type AsOfView = {
  vested: Installment[];
  unvested: Installment[];
  impossible: Installment[];
  unresolved: number;
  summary: Summary;
};

// The grant's resolved tranches inside a [from, to] window.
export type WindowView = {
  vested_in_window: number;
  tranches_in_window: number;
  installments: Installment[];
};

// One clause-group's contribution to the program: its own tranches and the
// blockers holding it back. A group is a single statement, except for a THEN
// chain, whose segments evaluate together (a tail has no start without its head)
// and so report as one entry. No verdict — a clause has no storable schedule of
// its own (the grant stores one template). This is for attribution: which clause
// produced what, and which is still waiting on something. Each clause is its own
// evaluation against the whole grant, so floor rounding telescopes only within a
// clause — on non-divisible portions the breakdown's amounts can differ from the
// collapsed schedule's by a share (1/3 PLUS 2/3 of 100 reads 33 + 66 against a
// collapsed 100). The collapsed schedule is the authority; the breakdown explains,
// it doesn't reconcile.
export type ClauseBreakdown = Pick<ScheduleView, "installments" | "blockers">;

// Attribute the program to its clause-groups. A second resolution pass, separate
// from the collapse — the only way to keep each clause's tranches apart once the
// collapse has merged them. Wrapped so a breakdown failure degrades to no
// breakdown rather than sinking the whole-program result, which already succeeded.
function clauseBreakdown(
  program: Parameters<typeof evaluateClauseGroups>[0],
  ctx: Parameters<typeof evaluateClauseGroups>[1],
): ClauseBreakdown[] {
  try {
    return evaluateClauseGroups(program, ctx)
      .map(toScheduleView)
      .map(({ installments, blockers }) => ({ installments, blockers }));
  } catch {
    return [];
  }
}

// Evaluate a grant. The program collapses into ONE schedule with one verdict and
// one allocation finding (`view`); on top of that the breakdown shows what each
// clause contributed, for callers that want per-clause attribution.
//
// The collapse runs template recovery: an events-only program whose realized
// projection happens to have a single-template form is rescued back to a
// template, transparently.
export function runEvaluate(
  dsl: string,
  g: GrantInput,
): Result<{
  view: ScheduleView;
  recovered?: RecoveredView;
  breakdown: ClauseBreakdown[];
}> {
  const parsed = parseToProgram(dsl);
  if (!parsed.ok) return parsed;
  const ctx = buildContext(g);
  try {
    const outcome = evaluateProgramWithRecovery(parsed.program, ctx);
    const view = toScheduleView(outcome.schedule);
    const breakdown = clauseBreakdown(parsed.program, ctx);
    const recovered = outcome.rescued
      ? {
          from: outcome.recovered.from,
          // The captured reason is structured now; render it for the view.
          reason: reasonToString(outcome.recovered.reason),
          dsl: outcome.recovered.dsl,
          vestingDayOfMonth: outcome.recovered.vestingDayOfMonth,
          residualError: outcome.recovered.residualError,
        }
      : undefined;
    return {
      ok: true,
      view,
      breakdown,
      ...(recovered ? { recovered } : {}),
    };
  } catch (err) {
    return { ok: false, error: toEvaluationError(err) };
  }
}

// Point-in-time view: the whole grant partitioned into vested/unvested/impossible
// as of `asOf` (defaulting to today), with a summary.
export function runAsOf(
  dsl: string,
  g: GrantInput,
  asOf?: OCTDate,
): Result<{ asOf: OCTDate } & AsOfView> {
  const parsed = parseToProgram(dsl);
  if (!parsed.ok) return parsed;
  const ctx = buildContext({ ...g, as_of: asOf });
  try {
    const result = evaluateProgramAsOf(parsed.program, ctx);
    return {
      ok: true,
      asOf: ctx.asOf,
      vested: result.vested,
      unvested: result.unvested,
      impossible: result.impossible,
      unresolved: result.unresolved,
      summary: computeSummary(result, ctx.grantQuantity),
    };
  } catch (err) {
    return { ok: false, error: toEvaluationError(err) };
  }
}

// The grant's resolved tranches whose vest date falls within [from, to],
// inclusive. The cutoff is `to`, so there's no separate as-of to pass. Owns the
// ordering check.
export function runVestedBetween(
  dsl: string,
  g: GrantInput,
  from: OCTDate,
  to: OCTDate,
): Result<{ from: OCTDate; to: OCTDate } & WindowView> {
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
    const result = evaluateProgramAsOf(parsed.program, ctx);
    const { installments, total } = filterByWindow(result.vested, from, to);
    return {
      ok: true,
      from,
      to,
      vested_in_window: total,
      tranches_in_window: installments.length,
      installments,
    };
  } catch (err) {
    return { ok: false, error: toEvaluationError(err) };
  }
}
