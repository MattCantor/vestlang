import { evaluateProgram, evaluateStatement } from "@vestlang/evaluator";
import type {
  OCTDate,
  Program,
  ResolvedInstallment,
  Status,
  VestingDayOfMonth,
} from "@vestlang/types";
import type { TrancheInput } from "./types.js";

const EPSILON = 1e-6;

export interface VerifyContext {
  grantDate: OCTDate;
  totalQuantity: number;
  asOf: OCTDate;
  vestingDayOfMonth: VestingDayOfMonth;
}

export function residualAgainstInput(
  program: Program,
  input: TrancheInput[],
  ctx: VerifyContext,
): { residual: number; installments: ResolvedInstallment[] } {
  const produced = new Map<string, number>();

  for (const stmt of program) {
    const result = evaluateStatement(stmt, {
      events: { grantDate: ctx.grantDate },
      grantQuantity: ctx.totalQuantity,
      asOf: ctx.asOf,
      vesting_day_of_month: ctx.vestingDayOfMonth,
    });
    for (const inst of result.installments) {
      if (inst.meta.state !== "RESOLVED") {
        return { residual: Number.POSITIVE_INFINITY, installments: [] };
      }
      const key = inst.date as unknown as string;
      produced.set(key, (produced.get(key) ?? 0) + inst.amount);
    }
  }

  const expected = new Map<string, number>();
  for (const t of input) {
    const key = t.date;
    expected.set(key, (expected.get(key) ?? 0) + t.amount);
  }

  let residual = 0;
  const keys = new Set<string>([...produced.keys(), ...expected.keys()]);
  for (const k of keys) {
    const got = produced.get(k) ?? 0;
    const want = expected.get(k) ?? 0;
    residual += Math.abs(got - want);
  }

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
    events: { grantDate: ctx.grantDate },
    grantQuantity: ctx.totalQuantity,
    asOf: ctx.asOf,
    vesting_day_of_month: ctx.vestingDayOfMonth,
  });
  return schedule.status;
}
