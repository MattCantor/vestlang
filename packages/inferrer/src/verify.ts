import { evaluateStatement } from "@vestlang/evaluator";
import type {
  allocation_type,
  OCTDate,
  Program,
  ResolvedInstallment,
  vesting_day_of_month,
} from "@vestlang/types";
import type { TrancheInput } from "./types.js";

const EPSILON = 1e-6;

export interface VerifyContext {
  grantDate: OCTDate;
  totalQuantity: number;
  asOf: OCTDate;
  vestingDayOfMonth: vesting_day_of_month;
  allocationType: allocation_type;
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
      allocation_type: ctx.allocationType,
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
    const key = t.date as unknown as string;
    expected.set(key, (expected.get(key) ?? 0) + t.amount);
  }

  let residual = 0;
  const keys = new Set<string>([
    ...produced.keys(),
    ...expected.keys(),
  ]);
  for (const k of keys) {
    const got = produced.get(k) ?? 0;
    const want = expected.get(k) ?? 0;
    residual += Math.abs(got - want);
  }

  const installments: ResolvedInstallment[] = [];
  for (const [key, amount] of produced.entries()) {
    if (amount > EPSILON) {
      installments.push({
        date: key as unknown as OCTDate,
        amount,
        meta: { state: "RESOLVED" },
      });
    }
  }
  installments.sort((a, b) =>
    (a.date as unknown as string).localeCompare(b.date as unknown as string),
  );

  return { residual, installments };
}
