// The orchestrators. Each takes a grant's raw scalars plus the DSL, runs the
// whole chain (parse → build context → evaluate → shape), and hands back either
// a display-ready result or one PipelineError. An app calling these never owns
// the sequence, so it can't skip a step or drop an argument; all it adds is the
// per-statement index and the rendering.
//
// The signatures deliberately differ — an "as of" date only appears where it
// means something. Don't fold them back into one ctx argument.

import {
  evaluateProgramAsOf,
  evaluateClauseGroups,
  chainGroupIndices,
  type StatementContribution,
} from "@vestlang/evaluator";
import { coalesceAtGrantDate } from "@vestlang/primitives";
import { toScheduleView, reasonToString, type ScheduleView } from "./view.js";
import { evaluateProgramWithRecovery } from "@vestlang/recover";
import type {
  Finding,
  Installment,
  OCTDate,
  Program,
  ResolutionContextInput,
  ResolvedInstallment,
  VestingDayOfMonth,
} from "@vestlang/types";
import { parseToProgram, toEvaluationError, type Result } from "./parse.js";
import { buildContext, buildAsOfContext } from "./context.js";
import { computeSummary, filterByWindow, type Summary } from "./summary.js";
import { errorFindings, formatFinding } from "./findings.js";

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

// A finding paired with its rendered sentence — the same shape `toScheduleView`
// hands the `evaluate` surface, so the validity channel reads identically across
// the three read tools.
type FindingView = Finding & { message: string };

// True when nothing error-severity is flagged (an over-allocation flips it; a
// warning like under-allocation does not). Each as-of surface derives validity
// off the same `result.findings`, so they agree with one another and with
// `evaluate`.
const asOfFindings = (
  findings: Finding[],
): { valid: boolean; findings: FindingView[] } => ({
  valid: errorFindings(findings).length === 0,
  findings: findings.map((f) => ({ ...f, message: formatFinding(f) })),
});

// The whole grant's point-in-time partition, plus the roll-up. `valid`/`findings`
// carry the validity verdict — the partition is still returned for an
// over-allocating schedule (annotate, don't certify), but flagged as not legal.
export type AsOfView = {
  vested: Installment[];
  unvested: Installment[];
  impossible: Installment[];
  unresolved: number;
  summary: Summary;
  valid: boolean;
  findings: FindingView[];
};

// The grant's resolved tranches inside a [from, to] window, with the same
// validity verdict — the window sum is the real (unclamped) total even when the
// schedule over-allocates.
export type WindowView = {
  vested_in_window: number;
  tranches_in_window: number;
  installments: Installment[];
  valid: boolean;
  findings: FindingView[];
};

// One clause-group's contribution to the program: its own tranches and the
// blockers holding it back, split into pending (still waiting) and dead
// (contradicted given the firings) to match the schedule level. A group is a
// single statement, except for a THEN chain, whose segments evaluate together (a
// tail has no start without its head) and so report as one entry. No verdict — a
// clause has no storable schedule of its own (the grant stores one template). This
// is for attribution: which clause produced what, and which is still waiting on
// something. The amounts are a true PARTITION of the headline allocation — each
// clause's slice of the one single-cumulative allocation — so they sum to the
// collapsed schedule by construction (a clause adopts the headline's odd-share
// placement, e.g. 1/3 PLUS 1/3 PLUS 1/3 of 100 reads 33/33/34 here and in the
// headline). When the headline itself over-allocates, the partition still ties to
// it, but that total isn't a legal allocation — `valid`/`findings` carry that.
export type ClauseBreakdown = Pick<
  ScheduleView,
  "installments" | "pendingBlockers" | "deadBlockers"
>;

// A chain-group's installments: the union of its member statements' partition
// slices, re-coalesced at the grant date so a THEN chain's pre-grant rows across
// its segments merge into one grant-date tranche (a backdated start shows one
// merged tranche, not several). Dated tranches lead, symbolic ones follow — the
// per-clause shape a separate evaluation produced before.
function groupInstallments(
  members: StatementContribution[],
  grantDate: OCTDate,
): Installment[] {
  const dated: { date: OCTDate; statementOrder: number; amount: number }[] = [];
  const symbolic: Installment[] = [];
  for (const m of members) {
    for (const inst of m.installments) {
      if (inst.state === "RESOLVED")
        dated.push({
          date: inst.date,
          statementOrder: m.statementOrder,
          amount: inst.amount,
        });
      else symbolic.push(inst);
    }
  }
  const coalesced = coalesceAtGrantDate(dated, grantDate).map(
    (t): ResolvedInstallment => ({
      state: "RESOLVED",
      amount: t.amount,
      date: t.date,
    }),
  );
  return [...coalesced, ...symbolic];
}

// Attribute the program to its clause-groups, joining TWO channels positionally by
// chain-group index. The AMOUNT channel is the program's partition
// (`contributions`) rolled up by THEN chain — a true partition of the headline, so
// it sums by construction and CANNOT throw (it's read off the already-computed
// outcome). The BLOCKER channel is `evaluateClauseGroups`'s per-clause
// pending/dead lists; it re-resolves each clause and so CAN throw. Both passes
// group the SAME (original) program by the same chain logic, so they emit entries
// in the same order. Only the blocker pass is wrapped: on its failure the
// amount-bearing entries still stand with empty blocker lists, so the breakdown
// never degrades to `[]` (which would silently re-open the sum gap).
function clauseBreakdown(
  program: Program,
  ctx: ResolutionContextInput,
  contributions: StatementContribution[],
  grantDate: OCTDate,
): ClauseBreakdown[] {
  const groupIndex = chainGroupIndices(program);
  const groups: StatementContribution[][] = [];
  contributions.forEach((c, i) => {
    const g = groupIndex[i];
    (groups[g] ??= []).push(c);
  });
  const amounts = groups.map((members) =>
    groupInstallments(members, grantDate),
  );

  let blockers:
    | Pick<ScheduleView, "pendingBlockers" | "deadBlockers">[]
    | undefined;
  try {
    blockers = evaluateClauseGroups(program, ctx)
      .map(toScheduleView)
      .map(({ pendingBlockers, deadBlockers }) => ({
        pendingBlockers,
        deadBlockers,
      }));
  } catch {
    blockers = undefined;
  }

  return amounts.map((installments, g) => ({
    installments,
    pendingBlockers: blockers?.[g]?.pendingBlockers ?? [],
    deadBlockers: blockers?.[g]?.deadBlockers ?? [],
  }));
}

// Evaluate a grant. The program collapses into ONE schedule with one verdict and
// one allocation finding (`view`); on top of that the breakdown shows what each
// clause contributed, as a partition of that one allocation — so the per-clause
// amounts sum to the headline by construction.
//
// The collapse runs template recovery: an events-only program whose realized
// projection happens to have a single-template form is rescued back to a
// template, transparently. The breakdown attributes to the ORIGINAL author
// clauses either way (the partition is the pre-rescue one).
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
    const breakdown = clauseBreakdown(
      parsed.program,
      ctx,
      outcome.contributions,
      g.grant_date,
    );
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
  const ctx = buildAsOfContext({ ...g, as_of: asOf });
  try {
    const result = evaluateProgramAsOf(parsed.program, ctx);
    const { valid, findings } = asOfFindings(result.findings);
    return {
      ok: true,
      asOf: ctx.asOf,
      vested: result.vested,
      unvested: result.unvested,
      impossible: result.impossible,
      unresolved: result.unresolved,
      // When invalid, the summary keeps its numbers honest and only drops the
      // completion date — see computeSummary.
      summary: computeSummary(result, ctx.grantQuantity, valid),
      valid,
      findings,
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
  const ctx = buildAsOfContext({ ...g, as_of: to });
  try {
    const result = evaluateProgramAsOf(parsed.program, ctx);
    const { installments, total } = filterByWindow(result.vested, from, to);
    // No summary path here, so validity reads straight off the same findings.
    const { valid, findings } = asOfFindings(result.findings);
    return {
      ok: true,
      from,
      to,
      vested_in_window: total,
      tranches_in_window: installments.length,
      installments,
      valid,
      findings,
    };
  } catch (err) {
    return { ok: false, error: toEvaluationError(err) };
  }
}
