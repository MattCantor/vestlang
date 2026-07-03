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
// `inferSchedule` delegates to `analyze`, the single public entry here.

import { parse } from "@vestlang/dsl";
import { evaluateProgram } from "@vestlang/evaluator";
import { normalizeProgram } from "@vestlang/normalizer";
import { stringify } from "@vestlang/render";
import type {
  Installment,
  OCTDate,
  Program,
  ResolutionContextInput,
  Statement,
  VestingDayOfMonth,
} from "@vestlang/types";
import type {
  DecompositionComponent,
  HypothesisFamily,
  TrancheInput,
} from "../types.js";
import { bareLumpStmt } from "./emit.js";
import { candidates } from "./families.js";
import {
  aggregateProjection,
  bucketByDate,
  DEFAULT_DOM,
  type Projection,
  type Row,
} from "./solvers.js";

/** The full analytic result the wired `inferSchedule` builds its `InferResult`
 *  from — the rendered DSL, the day-of-month it verified under, the typed winning
 *  program (evaluated directly by `@vestlang/recover`), the tagged decomposition,
 *  and whether the literal fallback fired. */
export interface AnalysisResult {
  dsl: string;
  dom: VestingDayOfMonth;
  program: Program;
  components: DecompositionComponent[];
  fallback: boolean;
}

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
    // A throwing candidate (e.g. a Fraction-overflow cliff product) is contained
    // and scored out.
    return false;
  }
}

/** Read a built statement's parameters back for the tagged decomposition. The
 *  emitter only ever produces plain `SCHEDULE` statements (no selectors), so the
 *  non-SCHEDULE arm is defensive. A chained THEN tail carries a null start. */
function describeStatement(
  stmt: Statement,
  tag: HypothesisFamily,
): DecompositionComponent {
  const total = stmt.amount.type === "QUANTITY" ? stmt.amount.value : 0;
  const expr = stmt.expr;
  if (expr.type !== "SCHEDULE") {
    return {
      tag,
      start: null,
      occurrences: 0,
      period: { unit: "MONTHS", length: 0 },
      total,
    };
  }
  const p = expr.periodicity;
  const vs = expr.vesting_start;
  const start =
    vs !== null && vs.type === "NODE" && vs.base.type === "DATE"
      ? vs.base.value
      : null;
  const cliff = p.cliff;
  const cliffOffset =
    cliff && cliff.type === "NODE" ? cliff.offsets[0] : undefined;
  return {
    tag,
    start,
    occurrences: p.occurrences,
    period: { unit: p.type, length: p.length },
    total,
    ...(cliffOffset ? { cliffLength: cliffOffset.value } : {}),
  };
}

function componentsOf(
  program: Program,
  tag: HypothesisFamily,
): DecompositionComponent[] {
  return program.map((stmt) => describeStatement(stmt, tag));
}

/** Literal per-date decomposition — projection-lossless by construction. Each row
 *  becomes its own dated lump (a PLUS list); an empty stream becomes a single
 *  zero-quantity statement anchored at the grant. Every component is `literal`. */
function fallback(rows: Row[], grantDate: OCTDate): AnalysisResult {
  const program: Program =
    rows.length === 0
      ? [bareLumpStmt(0, grantDate)]
      : rows.map((r) => bareLumpStmt(r.amount, r.date));
  return {
    dsl: stringify(program),
    dom: DEFAULT_DOM,
    program,
    components: componentsOf(program, "literal"),
    fallback: true,
  };
}

function aggregateRows(tranches: TrancheInput[]): Row[] {
  // Deviation: aggregate same-date rows, then DROP zero-total dates before
  // decomposition (matching the pipeline's `occupied()`). The evaluator never
  // emits a zero-amount installment, so on real streams this drops nothing.
  return bucketByDate(tranches, true);
}

/** The wired entry point: decompose → hypothesize → verify, returning the full
 *  analytic result. `inferSchedule` assembles its `InferResult` from this. */
export function analyze(
  tranches: TrancheInput[],
  grantDate: OCTDate,
  policyHint?: VestingDayOfMonth,
): AnalysisResult {
  try {
    const rows = aggregateRows(tranches);
    const T = rows.reduce((s, r) => s + r.amount, 0);
    // An all-zero stream is out of scope here (inferSchedule's own short-circuit
    // keeps owning it); fall back rather than decompose an empty date set.
    if (rows.length === 0 || T === 0) return fallback(rows, grantDate);

    // `rows` are already bucketed and code-unit sorted, so the verify target is a
    // straight field rename (amount → total), not a second bucket-by-date pass.
    const target: Projection = rows.map((r) => ({
      date: r.date,
      total: r.amount,
    }));
    const seen = new Set<string>();
    let evals = 0;
    for (const cand of candidates(rows, T, grantDate, policyHint)) {
      // Render ONCE through the same stringify path the emitter's DSL takes.
      let dsl: string;
      try {
        dsl = stringify(cand.program);
      } catch {
        continue;
      }
      const key = `${cand.dom}|${dsl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (++evals > MAX_EVALS) break;
      // First verifying candidate in preference order wins.
      if (verify(dsl, cand.dom, grantDate, T, target))
        return {
          dsl,
          dom: cand.dom,
          program: cand.program,
          components: componentsOf(cand.program, cand.tag),
          fallback: false,
        };
    }
    return fallback(rows, grantDate);
  } catch {
    // Outer guard: a candidate-GENERATION throw still lands in the literal
    // fallback rather than crashing the inference.
    return fallback(aggregateRows(tranches), grantDate);
  }
}
