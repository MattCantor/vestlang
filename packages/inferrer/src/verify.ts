import { evaluateProgram, evaluateStatement } from "@vestlang/evaluator";
import type {
  OCTDate,
  Program,
  ResolvedInstallment,
  Status,
  VestingDayOfMonth,
} from "@vestlang/types";
import { projectionResidual } from "./residual.js";
import type { TrancheInput } from "./types.js";

const EPSILON = 1e-6;

export interface VerifyContext {
  grantDate: OCTDate;
  totalQuantity: number;
  asOf: OCTDate;
  vestingDayOfMonth: VestingDayOfMonth;
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
    const result = evaluateStatement(stmt, {
      grantDate: ctx.grantDate,
      events: {},
      grantQuantity: ctx.totalQuantity,
      asOf: ctx.asOf,
      vesting_day_of_month: ctx.vestingDayOfMonth,
    });
    for (const inst of result.resolution.installments) {
      if (inst.meta.state !== "RESOLVED") {
        return { residual: Number.POSITIVE_INFINITY, installments: [] };
      }
      const key = inst.date as unknown as string;
      produced.set(key, (produced.get(key) ?? 0) + inst.amount);
    }
  }

  const residual = residualBetween(produced, input);

  const installments: ResolvedInstallment[] = [];
  for (const [key, amount] of produced.entries()) {
    if (amount > EPSILON) {
      installments.push({
        date: key,
        amount,
        meta: { state: "RESOLVED" },
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
): { residual: number; status: Status } {
  const [schedule] = evaluateProgram(program, {
    grantDate: ctx.grantDate,
    events: {},
    grantQuantity: ctx.totalQuantity,
    asOf: ctx.asOf,
    vesting_day_of_month: ctx.vestingDayOfMonth,
  });

  const produced = new Map<string, number>();
  // We care about the closed-world result here — what the program actually
  // resolves to against the (empty) events — so read off the resolution verdict.
  const { status, installments } = schedule.resolution;
  for (const inst of installments) {
    if (inst.meta.state !== "RESOLVED" || inst.date === undefined) {
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
export function programStatus(program: Program, ctx: VerifyContext): Status {
  const [schedule] = evaluateProgram(program, {
    grantDate: ctx.grantDate,
    events: {},
    grantQuantity: ctx.totalQuantity,
    asOf: ctx.asOf,
    vesting_day_of_month: ctx.vestingDayOfMonth,
  });
  return schedule.resolution.status;
}
