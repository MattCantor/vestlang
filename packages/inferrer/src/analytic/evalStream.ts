// The one piece of evaluation plumbing both verification paths share: build
// the no-events resolution context, run the real evaluator, and hand back the
// RESOLVED {date, amount} stream with the verdict. Judgment stays with the
// callers — the driver's verify demands a clean `template` and compares
// aggregated projections, while the cover search buckets per-date totals and
// tolerates `events-only` on an assembled cover.

import { evaluateProgram } from "@vestlang/evaluator";
import type {
  Installment,
  OCTDate,
  Program,
  ResolutionContextInput,
  ResolvedInstallment,
  VestingDayOfMonth,
} from "@vestlang/types";
import type { Row } from "./solvers.js";

/** Null when the evaluation throws (the candidate loses, never crashes the run)
 *  or when anything fails to resolve. */
export function evalResolvedStream(
  program: Program,
  grantDate: OCTDate,
  total: number,
  dom: VestingDayOfMonth,
): { status: string; stream: Row[] } | null {
  try {
    const ctx: ResolutionContextInput = {
      grantDate,
      events: {},
      grantQuantity: total,
      vesting_day_of_month: dom,
    };
    const r = evaluateProgram(program, ctx).resolution;
    const items: Installment[] = r.installments;
    const resolved = items.filter(
      (i): i is ResolvedInstallment => i.state === "RESOLVED",
    );
    if (resolved.length !== items.length) return null;
    return {
      status: r.status,
      stream: resolved.map((i) => ({ date: i.date, amount: i.amount })),
    };
  } catch {
    return null;
  }
}
