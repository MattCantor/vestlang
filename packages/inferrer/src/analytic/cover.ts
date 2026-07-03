// Bounded PLUS-cover search: the additive subproblem the closed-form path
// structurally cannot express.
//
// The analytic rebuild (see ./driver.ts) replaced the old cover search with
// closed-form derivation — and that remains the whole single-template story:
// every one-schedule reading (plain, cliff, fold, THEN chain, dated lump) is
// still derived and verified without searching. What closed form cannot do is
// un-mix a SUM: when two or three schedules run concurrently, the observed
// per-date totals are a superposition and no single statement's parameters are
// observable in them. This module reintroduces search for exactly that
// subproblem, fenced so the old search's failure modes can't return:
//   - it runs only after every single-schedule reading has failed;
//   - it is deterministic — seeds in dominance order (largest contribution
//     first), the existing candidate order on each residual, first verifying
//     cover wins;
//   - it draws every evaluator call from a fixed work budget and degrades to
//     the literal per-date fallback when the budget or the seed space runs out;
//   - acceptance rests ONLY on evaluating the assembled program through the
//     real evaluator — the arithmetic residual guides the search but never
//     accepts a cover.
//
// The algorithm is peel-and-recurse. A SEED is a plain uniform month train read
// off the dates sharing one literal day-of-month: that group's month lattice
// gives the cadence, and the seed's total is either the group's full sum (the
// whole day-train is one layer) or min-amount × occurrences (a flat train
// sitting underneath same-date overlap). Each variant is tried across the
// group's day-of-month hypotheses (the same `domCandidates` order the families
// use; a caller hint collapses it to the hint). A seed qualifies only if its own
// evaluated projection never over-contributes on any date. Subtracting it leaves
// a residual that the full existing family machinery re-reads — which is how a
// non-train second layer (a cliff, a THEN chain, a dated lump, a DAYS train)
// gets into a cover — and one further peel is allowed when the residual is
// itself still a superposition. At most two peels, at most three statements,
// and always strictly fewer statements than the literal per-date form.
//
// Honest boundary: every seed is a plain month train on a fixed day-of-month,
// so a cover is reachable only when at least one layer reads that way (after
// at most one other such layer is peeled off). Superpositions of three-plus
// non-train layers, month-end layers whose dates drift across literal days,
// and streams whose smallest exact cover needs four or more statements all
// stay on the literal fallback.
//
// SEED ORDER (deterministic, ties broken by generation order): day-of-month
// groups in first-occurrence order; per group, the full-sum total before the
// min×N total; per total, the group's `domCandidates` order. All variants are
// then stable-sorted by total, largest first.

import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { stringify } from "@vestlang/render";
import type { OCTDate, Program, VestingDayOfMonth } from "@vestlang/types";
import { projectionResidual } from "../projection.js";
import type { HypothesisFamily } from "../types.js";
import { plainUniformStmt } from "./emit.js";
import { evalResolvedStream } from "./evalStream.js";
import { candidates } from "./families.js";
import {
  bucketByDate,
  domCandidates,
  monthDeltas,
  monthIdx,
  startISO,
  type Row,
} from "./solvers.js";

/** One layer of a verified cover: the statements a single winning reading
 *  emitted, all under that reading's family tag (a THEN residual stamps each of
 *  its segments `then-segment`; a bare-lump residual stamps `literal`). */
export interface CoverLayer {
  program: Program;
  tag: HypothesisFamily;
}

export type CoverOutcome =
  | {
      kind: "cover";
      dsl: string;
      dom: VestingDayOfMonth;
      program: Program;
      layers: CoverLayer[];
    }
  | { kind: "miss"; budgetExhausted: boolean };

/** Every evaluator call the search makes — seed projections, residual candidate
 *  verifications, assembled-program checks — draws one unit. Tripping the budget
 *  aborts the whole search (the caller degrades to the literal fallback). */
interface WorkBudget {
  remaining: number;
  tripped: boolean;
}

function draw(budget: WorkBudget): boolean {
  if (budget.remaining <= 0) {
    budget.tripped = true;
    return false;
  }
  budget.remaining--;
  return true;
}

/** Budgeted evaluation: draw one unit, run the shared evaluation plumbing, and
 *  aggregate the RESOLVED installments by date. Null when the budget trips or
 *  the evaluation fails. The verdict rides along: a residual layer must stand
 *  alone as a clean `template`, while the assembled cover legitimately resolves
 *  `events-only` (overlapping dated grids). */
function resolvedTotals(
  program: Program,
  grantDate: OCTDate,
  total: number,
  dom: VestingDayOfMonth,
  budget: WorkBudget,
): { status: string; totals: Row[] } | null {
  if (!draw(budget)) return null;
  const r = evalResolvedStream(program, grantDate, total, dom);
  if (r === null) return null;
  return { status: r.status, totals: bucketByDate(r.stream, true) };
}

interface Seed {
  program: Program;
  total: number;
  dom: VestingDayOfMonth;
}

function seedsOf(
  rows: Row[],
  grantDate: OCTDate,
  hint?: VestingDayOfMonth,
): Seed[] {
  // Group by literal day-of-month, insertion-ordered by first occurrence. Rows
  // are bucketed by date, so months within a group are distinct by construction.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const day = r.date.slice(8, 10);
    const g = groups.get(day);
    if (g) g.push(r);
    else groups.set(day, [r]);
  }

  const out: Seed[] = [];
  for (const group of groups.values()) {
    const mis = group.map((r) => monthIdx(r.date));
    const deltas = monthDeltas(mis);
    if (deltas === null) continue;
    if (deltas.length > 0 && deltas.some((d) => d !== deltas[0])) continue;
    const p = deltas.length > 0 ? deltas[0] : 1;
    const N = group.length;
    const sum = group.reduce((s, r) => s + r.amount, 0);
    const min = Math.min(...group.map((r) => r.amount));

    const totals: number[] = [];
    // A group spanning the whole stream at its full sum is just a plain reading
    // of the entire stream — the single-family loop already tried and rejected
    // it, so only the sub-train total is worth offering there.
    if (N < rows.length) totals.push(sum);
    if (min >= 1 && min * N !== sum) totals.push(min * N);

    const dates = group.map((r) => r.date);
    for (const total of totals) {
      for (const dc of domCandidates(dates, hint)) {
        const startMi = mis[0] - p + (dc.underflow ? 1 : 0);
        const start = startISO(dc, startMi, grantDate);
        if (!start) continue;
        out.push({
          program: [
            plainUniformStmt(total, start, { unit: "MONTHS", length: p }, N),
          ],
          total,
          dom: dc.dom,
        });
      }
    }
  }
  // Dominance order. The sort is stable, so equal totals keep generation order.
  return out.sort((a, b) => b.total - a.total);
}

/** Seed gate: the seed's own projection must sit pointwise at-or-under the
 *  target — it never over-contributes on any date, and never places mass on a
 *  date the target doesn't occupy. */
function pointwiseWithin(proj: Row[], target: Row[]): boolean {
  const byDate = new Map(target.map((r) => [r.date, r.amount]));
  return proj.every((p) => (byDate.get(p.date) ?? 0) >= p.amount);
}

function subtract(target: Row[], proj: Row[]): Row[] {
  return bucketByDate(
    [...target, ...proj.map((p) => ({ date: p.date, amount: -p.amount }))],
    true,
  );
}

/** Single-family readings of a residual, in the family machinery's own
 *  deterministic order, each verified by one real evaluation against the
 *  residual's per-date totals. The seed's day-of-month rides in as the hint, so
 *  every layer of a cover shares one policy. */
function* residualReadings(
  rows: Row[],
  grantDate: OCTDate,
  dom: VestingDayOfMonth,
  maxStatements: number,
  budget: WorkBudget,
): Generator<CoverLayer> {
  const T = rows.reduce((s, r) => s + r.amount, 0);
  const seen = new Set<string>();
  for (const cand of candidates(rows, T, grantDate, dom)) {
    if (budget.tripped) return;
    if (cand.program.length > maxStatements) continue;
    let dsl: string;
    try {
      dsl = stringify(cand.program);
    } catch {
      continue;
    }
    if (seen.has(dsl)) continue;
    seen.add(dsl);
    let program: Program;
    try {
      program = normalizeProgram(parse(dsl));
    } catch {
      continue;
    }
    const recovered = resolvedTotals(program, grantDate, T, cand.dom, budget);
    if (recovered === null) {
      if (budget.tripped) return;
      continue;
    }
    if (recovered.status !== "template") continue;
    if (projectionResidual(rows, recovered.totals) !== 0) continue;
    yield { program: cand.program, tag: cand.tag };
  }
}

/** A candidate stack of layers, all verified under one day-of-month policy (the
 *  head seed's — the residual re-runs inherit it as their hint). */
interface Stack {
  layers: CoverLayer[];
  dom: VestingDayOfMonth;
}

/** Candidate layer stacks for a residual, depth-first: every verifying
 *  single-family reading first, then — if a peel remains — whatever `peeled`
 *  finds underneath another seed. */
function* stacks(
  rows: Row[],
  grantDate: OCTDate,
  dom: VestingDayOfMonth,
  peelsLeft: number,
  maxStatements: number,
  budget: WorkBudget,
): Generator<Stack> {
  if (maxStatements < 1 || budget.tripped) return;
  for (const layer of residualReadings(
    rows,
    grantDate,
    dom,
    maxStatements,
    budget,
  )) {
    yield { layers: [layer], dom };
  }
  yield* peeled(rows, grantDate, dom, peelsLeft, maxStatements, budget);
}

/** Peel one seed off `rows` and recurse on what it leaves behind. The top-level
 *  search enters here directly — the caller's single-family loop has already
 *  exhausted every whole-stream reading, so re-trying it would only burn budget. */
function* peeled(
  rows: Row[],
  grantDate: OCTDate,
  hint: VestingDayOfMonth | undefined,
  peelsLeft: number,
  maxStatements: number,
  budget: WorkBudget,
): Generator<Stack> {
  if (peelsLeft < 1 || maxStatements < 2) return;
  for (const seed of seedsOf(rows, grantDate, hint)) {
    if (budget.tripped) return;
    const proj = resolvedTotals(
      seed.program,
      grantDate,
      seed.total,
      seed.dom,
      budget,
    );
    if (proj === null || proj.totals.length === 0) continue;
    if (!pointwiseWithin(proj.totals, rows)) continue;
    const residual = subtract(rows, proj.totals);
    if (residual.length === 0) continue;
    for (const rest of stacks(
      residual,
      grantDate,
      seed.dom,
      peelsLeft - 1,
      maxStatements - 1,
      budget,
    )) {
      yield {
        layers: [{ program: seed.program, tag: "plain" }, ...rest.layers],
        dom: seed.dom,
      };
    }
  }
}

/**
 * Search for a compact PLUS cover of `rows` — at most three concurrent
 * statements whose date-by-date sum reproduces the stream exactly, in strictly
 * fewer statements than the literal per-date form. Runs only after every
 * single-schedule reading has failed; the caller supplies the work budget.
 *
 * A stack is accepted only after assembling ALL its layers into one program and
 * evaluating that through the real evaluator. Summing the layers' own verified
 * projections would not do: allocation and the installment cap are applied to
 * the program as a whole, so only the assembled evaluation proves the merged
 * emission reproduces the target.
 */
export function findPlusCover(
  rows: Row[],
  grantDate: OCTDate,
  policyHint: VestingDayOfMonth | undefined,
  maxEvals: number,
): CoverOutcome {
  const budget: WorkBudget = { remaining: maxEvals, tripped: false };
  const T = rows.reduce((s, r) => s + r.amount, 0);
  // Strictly-fewer-than-literal is a search bound, not an afterthought: a cover
  // may use at most min(3, dates − 1) statements, so a degenerate one-lump-per-
  // date "cover" can never be assembled in the first place.
  const maxStatements = Math.min(3, rows.length - 1);
  if (maxStatements < 2) return { kind: "miss", budgetExhausted: false };

  for (const stack of peeled(
    rows,
    grantDate,
    policyHint,
    2,
    maxStatements,
    budget,
  )) {
    const program = stack.layers.flatMap((l) => l.program);
    let dsl: string;
    try {
      dsl = stringify(program);
    } catch {
      continue;
    }
    let assembled: Program;
    try {
      assembled = normalizeProgram(parse(dsl));
    } catch {
      continue;
    }
    const recovered = resolvedTotals(
      assembled,
      grantDate,
      T,
      stack.dom,
      budget,
    );
    if (recovered === null) {
      if (budget.tripped) break;
      continue;
    }
    if (projectionResidual(rows, recovered.totals) !== 0) continue;
    return {
      kind: "cover",
      dsl,
      dom: stack.dom,
      program,
      layers: stack.layers,
    };
  }
  return { kind: "miss", budgetExhausted: budget.tripped };
}
