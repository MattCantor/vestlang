// The analytic inverter: decompose → hypothesize → verify-with-the-real-evaluator.
//
// The invertibility study established that for single-statement templates every
// parameter is either exactly observable (total, prefix sums, month lattice) or
// pinned to a small candidate set (dom policy, cliff length, folded count). So
// instead of a cover search plus arithmetic fold guards, this derives candidate
// templates in closed form (./families.ts) and lets ONE real evaluation per
// candidate arbitrate. A candidate that throws scores out — it never crashes the
// run; if nothing verifies, the literal per-date fallback keeps the projection
// invariant.
//
// This is the stage-2b core, measured behind the pluggable sweep runner. It does
// not touch `inferSchedule`; 2c wires it in and retires the search machinery.

import { parse } from "@vestlang/dsl";
import { evaluateProgram } from "@vestlang/evaluator";
import { normalizeProgram } from "@vestlang/normalizer";
import { stringify } from "@vestlang/render";
import type {
  Installment,
  OCTDate,
  Program,
  ResolutionContextInput,
  VestingDayOfMonth,
} from "@vestlang/types";
import type { TrancheInput } from "../types.js";
import { bareLumpStmt } from "./emit.js";
import { candidates } from "./families.js";
import {
  aggregateProjection,
  DEFAULT_DOM,
  type Projection,
  type Row,
} from "./solvers.js";

/** Assignable to the sweep runner's `InferrerFn` (a wider 2-arg call site); the
 *  optional third arg is the trusted policy hint the 2c wiring will pass. */
export type AnalyticInferrer = (
  tranches: TrancheInput[],
  grantDate: OCTDate,
  policyHint?: VestingDayOfMonth,
) => { dsl: string; vestingDayOfMonth: VestingDayOfMonth };

export interface AnalyticStats {
  cases: number;
  evals: number;
  fallbacks: number;
  /** Candidate evaluations that THREW and were contained (scored out). */
  candidateThrows: number;
}

export const analyticStats: AnalyticStats = {
  cases: 0,
  evals: 0,
  fallbacks: 0,
  candidateThrows: 0,
};

// Hard stop on candidate evaluations per case, so a pathological scan can never
// hang the sweep. In practice the verified hit lands within the first handful.
const MAX_EVALS = 700;

/** Both projections are aggregated and date-sorted, so equality is a flat
 *  element-wise compare — kept local so the browser-bundled inferrer needs no
 *  `node:util`. */
function projectionsEqual(a: Projection, b: Projection): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++)
    if (a[i].date !== b[i].date || a[i].total !== b[i].total) return false;
  return true;
}

/** Evaluate a rendered candidate DSL through the public pipeline and check its
 *  aggregated per-date projection equals the target exactly. A throwing candidate
 *  (e.g. a Fraction-overflow cliff product) is contained and scored out. */
function verify(
  dsl: string,
  dom: VestingDayOfMonth,
  grantDate: OCTDate,
  total: number,
  target: Projection,
): boolean {
  try {
    const program = normalizeProgram(parse(dsl));
    const ctx: ResolutionContextInput = {
      grantDate,
      events: {},
      grantQuantity: total,
      vesting_day_of_month: dom,
    };
    const r = evaluateProgram(program, ctx).resolution;
    if (r.status !== "template") return false;
    const items: Installment[] = r.installments;
    if (!items.every((i) => i.state === "RESOLVED")) return false;
    const stream = items.map((i) => ({ date: i.date, amount: i.amount }));
    return projectionsEqual(aggregateProjection(stream), target);
  } catch {
    analyticStats.candidateThrows++;
    return false;
  }
}

/** Literal per-date decomposition — projection-lossless by construction. Each row
 *  becomes its own dated lump (a PLUS list); an empty stream becomes a single
 *  zero-quantity statement anchored at the grant. */
function fallback(
  rows: Row[],
  grantDate: OCTDate,
): { dsl: string; vestingDayOfMonth: VestingDayOfMonth } {
  const program: Program =
    rows.length === 0
      ? [bareLumpStmt(0, grantDate)]
      : rows.map((r) => bareLumpStmt(r.amount, r.date));
  return { dsl: stringify(program), vestingDayOfMonth: DEFAULT_DOM };
}

function aggregateRows(tranches: TrancheInput[]): Row[] {
  const byDate = new Map<OCTDate, number>();
  for (const t of tranches)
    byDate.set(t.date, (byDate.get(t.date) ?? 0) + t.amount);
  // Deviation: aggregate same-date rows, then DROP zero-total dates before
  // decomposition (matching the pipeline's `occupied()`). The evaluator never
  // emits a zero-amount installment, so on real streams this drops nothing.
  return [...byDate.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export const analyticInferrer: AnalyticInferrer = (
  tranches,
  grantDate,
  policyHint,
) => {
  analyticStats.cases++;
  try {
    const rows = aggregateRows(tranches);
    const T = rows.reduce((s, r) => s + r.amount, 0);
    // An all-zero stream is out of scope here (inferSchedule's own short-circuit
    // keeps owning it in 2c); fall back rather than decompose an empty date set.
    if (rows.length === 0 || T === 0) return fallback(rows, grantDate);

    const target = aggregateProjection(rows);
    const seen = new Set<string>();
    let evals = 0;
    for (const cand of candidates(rows, T, grantDate, policyHint)) {
      // Render ONCE through the same stringify path infer.ts uses.
      let dsl: string;
      try {
        dsl = stringify(cand.program);
      } catch {
        analyticStats.candidateThrows++;
        continue;
      }
      const key = `${cand.dom}|${dsl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (++evals > MAX_EVALS) break;
      analyticStats.evals++;
      // First verifying candidate in preference order wins.
      if (verify(dsl, cand.dom, grantDate, T, target))
        return { dsl, vestingDayOfMonth: cand.dom };
    }
    analyticStats.fallbacks++;
    return fallback(rows, grantDate);
  } catch {
    // Outer guard: a candidate-GENERATION throw still lands in the literal
    // fallback rather than crashing the inference.
    analyticStats.fallbacks++;
    return fallback(aggregateRows(tranches), grantDate);
  }
};
