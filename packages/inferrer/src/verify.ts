import { evaluateProgram, evaluateStatement } from "@vestlang/evaluator";
import type {
  EvaluatedSchedule,
  OCTDate,
  Program,
  ResolvedInstallment,
  ResolutionStatus,
  VestingDayOfMonth,
} from "@vestlang/types";
import { EPSILON, projectionResidual } from "./residual.js";
import type { TrancheInput } from "./types.js";

export interface VerifyContext {
  grantDate: OCTDate;
  totalQuantity: number;
  vestingDayOfMonth: VestingDayOfMonth;
}

/** Assemble the context every scoring call needs from the loose grant inputs. */
export function makeVerifyContext(
  grantDate: OCTDate,
  totalQuantity: number,
  policy: VestingDayOfMonth,
): VerifyContext {
  return { grantDate, totalQuantity, vestingDayOfMonth: policy };
}

/** Disagreement between the program's per-date output and the input stream.
 * Zero means the program reproduces the stream exactly. */
function residualBetween(
  produced: Map<string, number>,
  input: TrancheInput[],
): number {
  const producedStream = [...produced].map(([date, amount]) => ({
    date,
    amount,
  }));
  return projectionResidual(producedStream, input);
}

export function residualAgainstInput(
  program: Program,
  input: TrancheInput[],
  ctx: VerifyContext,
): { residual: number; installments: ResolvedInstallment[] } {
  const produced = new Map<string, number>();

  for (const stmt of program) {
    let result: ReturnType<typeof evaluateStatement>;
    try {
      result = evaluateStatement(stmt, {
        grantDate: ctx.grantDate,
        events: {},
        grantQuantity: ctx.totalQuantity,
        vesting_day_of_month: ctx.vestingDayOfMonth,
      });
    } catch {
      // A candidate whose grid drives the exact-integer allocator past
      // Number.MAX_SAFE_INTEGER throws here rather than resolving. Score it out
      // of contention the same way an unresolved installment does — an
      // un-evaluable candidate must never win, and an uncontained throw would
      // escape inferSchedule entirely.
      return { residual: Number.POSITIVE_INFINITY, installments: [] };
    }
    for (const inst of result.resolution.installments) {
      if (inst.state !== "RESOLVED") {
        return { residual: Number.POSITIVE_INFINITY, installments: [] };
      }
      produced.set(inst.date, (produced.get(inst.date) ?? 0) + inst.amount);
    }
  }

  const residual = residualBetween(produced, input);

  const installments: ResolvedInstallment[] = [];
  for (const [key, amount] of produced.entries()) {
    if (amount > EPSILON) {
      installments.push({
        state: "RESOLVED",
        date: key,
        amount,
      });
    }
  }
  installments.sort((a, b) => a.date.localeCompare(b.date));

  return { residual, installments };
}

/**
 * Residual and verdict for a program scored as one whole, via the same collapse
 * `evaluate_program` performs. `residualAgainstInput` evaluates each statement on
 * its own, which a THEN chain can't survive — a chained tail has no start of its
 * own and throws when evaluated alone. Collapsing the program threads the chain's
 * handoffs, so it's the only way to score a candidate that uses THEN. The one
 * collapse hands back both the installments to diff and the program-level verdict.
 */
export function collapseAgainstInput(
  program: Program,
  input: TrancheInput[],
  ctx: VerifyContext,
): { residual: number; status: ResolutionStatus } {
  const schedule = tryEvaluateProgram(program, ctx);
  if (schedule === null) {
    // A candidate that overflows the exact-integer allocator can't collapse. Its
    // verdict is what this call feeds into selectBest, so hand back a rank-0 status
    // (ranked below events-only) — plus the same +Infinity residual the unresolved
    // arm below returns, so the residual gate rejects it too.
    return { residual: Number.POSITIVE_INFINITY, status: "impossible" };
  }

  const produced = new Map<string, number>();
  // We care about the closed-world result here — what the program actually
  // resolves to against the (empty) events — so read off the resolution verdict.
  const { status, installments } = schedule.resolution;
  for (const inst of installments) {
    if (inst.state !== "RESOLVED") {
      return { residual: Number.POSITIVE_INFINITY, status };
    }
    produced.set(inst.date, (produced.get(inst.date) ?? 0) + inst.amount);
  }

  return {
    residual: residualBetween(produced, input),
    status,
  };
}

/**
 * Collapse the whole program into one schedule and report its verdict — the same
 * `template` / `events-only` answer a consumer sees from `evaluate_program`.
 *
 * `residualAgainstInput` (above) evaluates each statement on its own; this asks
 * the harder question of whether the statements stitch back into a single
 * canonical template (every later start landing on the running cursor) or fall
 * apart into independent dated amounts. We use it to prefer a candidate that
 * recovers a template over one that only reproduces the numbers. The built
 * statements are evaluated as-is, exactly like the per-statement residual does.
 */
export function programStatus(
  program: Program,
  ctx: VerifyContext,
): ResolutionStatus {
  const schedule = tryEvaluateProgram(program, ctx);
  // Same containment as collapseAgainstInput: an un-collapsible candidate gets a
  // rank-0 verdict so selectBest ranks it below every events-only fit.
  if (schedule === null) return "impossible";
  return schedule.resolution.status;
}

/**
 * Collapse a whole program, containing the throw a candidate that overflows the
 * exact-integer allocator raises. Returns null instead of propagating, so each
 * scoring caller can turn an un-evaluable candidate into its own reject verdict
 * rather than letting the exception escape inferSchedule.
 */
function tryEvaluateProgram(
  program: Program,
  ctx: VerifyContext,
): EvaluatedSchedule | null {
  try {
    return evaluateProgram(program, {
      grantDate: ctx.grantDate,
      events: {},
      grantQuantity: ctx.totalQuantity,
      vesting_day_of_month: ctx.vestingDayOfMonth,
    });
  } catch {
    return null;
  }
}
