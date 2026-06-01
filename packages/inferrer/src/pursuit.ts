import type {
  EvaluationContext,
  OCTDate,
  VestingDayOfMonth,
  AllocationType,
} from "@vestlang/types";
import { allocateVector } from "@vestlang/core";
import {
  type Cadence,
  cadenceKey,
  estimateCadences,
  minimalCtx,
  walk,
} from "./cadence.js";
import type { Component, TrancheInput, UniformComponent } from "./types.js";

type Residual = Map<string, number>;

const EPSILON = 1e-6;

/** Max branches explored per decision node. Realistic schedules need few; this
 * caps pathological blow-up while staying optimal on clean inputs. */
const MAX_BRANCH = 16;
/** Hard cap on candidate cadences considered per residual, in estimator rank
 * order (data-derived modes first, then priors). */
const TOP_CADENCES = 5;

function toResidual(tranches: TrancheInput[]): Residual {
  const m = new Map<string, number>();
  for (const t of tranches) {
    const prev = m.get(t.date as unknown as string) ?? 0;
    m.set(t.date as unknown as string, prev + t.amount);
  }
  return m;
}

/** allocateVector fingerprints are monotonic in the total: increasing T never
 * decreases any position's share. So the set of T for which fingerprint <= mass
 * pointwise is a prefix [n, maxT]. Binary-search that maximal feasible T. */
function maxFeasibleTotal(
  mass: number[],
  n: number,
  mode: AllocationType,
): number {
  const fitsAt = (T: number): boolean => {
    const fp = allocateVector(T, n, mode);
    for (let k = 0; k < n; k++) {
      if (fp[k] - mass[k] > EPSILON) return false;
    }
    return true;
  };
  const hi0 = Math.round(mass.reduce((a, b) => a + b, 0));
  if (hi0 < n) return 0;
  if (fitsAt(hi0)) return hi0;
  let lo = n;
  let hi = hi0;
  if (!fitsAt(lo)) return 0;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fitsAt(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** walk can throw on degenerate policy/date combinations; treat a throw as "this
 * grid position does not exist" so a bad (policy, date) pair scores poorly rather
 * than crashing the whole inference. */
function safeWalk(
  from: OCTDate,
  cadence: Cadence,
  steps: number,
  ctx: EvaluationContext,
): OCTDate | null {
  try {
    return walk(from, cadence, steps, ctx);
  } catch {
    return null;
  }
}

function occupiedDates(r: Residual): OCTDate[] {
  return Array.from(r.keys())
    .filter((k) => (r.get(k) ?? 0) > EPSILON)
    .sort()
    .map((s) => s as unknown as OCTDate);
}

/** A candidate UNIFORM atom: a train whose allocation fingerprint fits (pointwise
 * <=) the residual mass on its run of on-grid dates. */
interface TrainAtom {
  start: OCTDate;
  cadence: Cadence;
  occurrences: number;
  total: number;
  perTrancheAmount: number; // fingerprint[0]; representative rate
  run: OCTDate[];
  fingerprint: number[];
  coverMass: number; // total mass this atom removes
}

/** Generate candidate train atoms covering `target`, for the given allocation.
 *
 * For each cadence and each on-grid run starting at `target`, the only totals
 * worth trying are:
 *   - the full mass on the run (a pure train), and
 *   - the full mass minus the excess at a single position (a train with one
 *     coincident lump — a cliff sitting on the train).
 * This yields O(runLength) candidate totals per run instead of a blind scan. */
function trainAtomsCovering(
  residual: Residual,
  target: OCTDate,
  cadences: Cadence[],
  ctx: EvaluationContext,
  mode: AllocationType,
): TrainAtom[] {
  const atoms: TrainAtom[] = [];
  const has = (d: OCTDate) =>
    (residual.get(d as unknown as string) ?? 0) > EPSILON;
  const massAt = (d: OCTDate) => residual.get(d as unknown as string) ?? 0;

  for (const cadence of cadences) {
    // Build the maximal on-grid run that begins at `target`.
    const run: OCTDate[] = [];
    for (let i = 0; ; i++) {
      const g = safeWalk(target, cadence, i, ctx);
      if (g === null) break;
      if (!has(g)) break;
      run.push(g);
      if (i > 600) break;
    }

    for (let n = run.length; n >= 2; n--) {
      const positions = run.slice(0, n);
      const mass = positions.map(massAt);
      const sum = mass.reduce((a, b) => a + b, 0);

      // The train's total T must satisfy: allocateVector(T, n, mode)[k] <= mass[k]
      // for every position k (so the leftover stays non-negative). Fingerprints are
      // monotonic in T, so there is a unique MAXIMAL feasible T — the train that
      // explains as much mass as possible while leaving only non-negative lumps.
      // Find it by binary search. We also keep T = sum (the pure-train hypothesis,
      // which fits exactly when the run has no coincident lump).
      const candidateTotals = new Set<number>();
      const maxT = maxFeasibleTotal(mass, n, mode);
      if (maxT >= n) candidateTotals.add(maxT);
      if (Math.round(sum) >= n) candidateTotals.add(Math.round(sum));

      for (const total of candidateTotals) {
        const fp = allocateVector(total, n, mode);
        let fits = true;
        for (let k = 0; k < n; k++) {
          if (fp[k] - mass[k] > EPSILON || fp[k] <= 0) {
            fits = false;
            break;
          }
        }
        if (!fits) continue;
        atoms.push({
          start: target,
          cadence,
          occurrences: n,
          total,
          perTrancheAmount: fp[0],
          run: positions,
          fingerprint: fp,
          coverMass: total,
        });
      }
    }
  }

  // Prefer atoms that remove the most mass (and longer runs) first.
  atoms.sort(
    (a, b) => b.coverMass - a.coverMass || b.occurrences - a.occurrences,
  );
  return atoms;
}

function applyAtom(residual: Residual, atom: TrainAtom): Residual {
  const next = new Map(residual);
  atom.run.forEach((d, k) => {
    const key = d as unknown as string;
    const v = (next.get(key) ?? 0) - atom.fingerprint[k];
    if (v <= EPSILON) next.delete(key);
    else next.set(key, v);
  });
  return next;
}

export interface DecomposeResult {
  components: Component[];
  cadencesTried: string[];
}

/** Minimum-cardinality exact cover of the installment residual by UNIFORM trains
 * and SINGLE_TRANCHE pulses, via branch-and-bound. The allocation `mode` defines
 * the rounding fingerprint a train must match, so jittery (rounded) trains are
 * recognized as single uniforms rather than fragmenting. Cliff folding happens
 * downstream in foldCliffs; this stage stays cliff-agnostic. */
export function decompose(
  tranches: TrancheInput[],
  policy: VestingDayOfMonth,
  mode: AllocationType,
): DecomposeResult {
  const ctx = minimalCtx(policy);
  const root = toResidual(tranches);

  // Per-residual cadence estimate (CLEAN-style): re-derive the candidate
  // dictionary from the *current* residual so a secondary cadence emerges once
  // the dominant train is peeled off. Records every cadence considered, so the
  // reported `cadencesTried` is the union across all passes.
  const triedKeys = new Set<string>();
  const estimate = (dates: OCTDate[]): Cadence[] => {
    const ranked = estimateCadences(dates).slice(0, TOP_CADENCES);
    for (const c of ranked) triedKeys.add(cadenceKey(c));
    return ranked;
  };

  // Greedy seed for an initial upper bound (also a valid answer if search is capped).
  const seed = greedyCover(root, estimate, ctx, mode);
  let best: Component[] = seed;
  let bestCost = seed.length;

  // Bounded exploration: B&B always terminates; if the budget is exhausted it
  // falls back to the best cover found so far (at worst, the greedy seed).
  let budget = 20000;

  // Branch and bound.
  const recurse = (residual: Residual, chosen: Component[]): void => {
    if (budget <= 0) return;
    budget--;
    if (chosen.length >= bestCost) return; // bound: cannot beat current best
    const dates = occupiedDates(residual);
    if (dates.length === 0) {
      best = chosen.slice();
      bestCost = chosen.length;
      return;
    }
    // Admissible bound: at least one more component is needed.
    if (chosen.length + 1 >= bestCost && dates.length > 0) {
      // still allow if exactly one component could finish it (handled by recursion)
    }

    const target = dates[0];
    const localRanked = estimate(dates);
    const atoms = trainAtomsCovering(
      residual,
      target,
      localRanked,
      ctx,
      mode,
    ).slice(0, MAX_BRANCH);

    // Branch: cover `target` with each candidate train.
    for (const atom of atoms) {
      const next = applyAtom(residual, atom);
      const comp: UniformComponent = {
        kind: "UNIFORM",
        startDate: atom.start,
        cadence: atom.cadence,
        occurrences: atom.occurrences,
        perTrancheAmount: atom.perTrancheAmount,
        total: atom.total,
      };
      recurse(next, [...chosen, comp]);
    }

    // Branch: cover `target` as a lone pulse.
    {
      const next = new Map(residual);
      const amt = next.get(target as unknown as string) ?? 0;
      next.delete(target as unknown as string);
      recurse(next, [
        ...chosen,
        { kind: "SINGLE_TRANCHE", date: target, amount: amt },
      ]);
    }
  };

  recurse(root, []);

  return { components: best, cadencesTried: [...triedKeys] };
}

/** Greedy fallback / upper-bound seed: repeatedly take the highest-mass fitting
 * train, then sweep leftovers into pulses. */
function greedyCover(
  root: Residual,
  estimate: (dates: OCTDate[]) => Cadence[],
  ctx: EvaluationContext,
  mode: AllocationType,
): Component[] {
  const residual = new Map(root);
  const components: Component[] = [];
  for (let iter = 0; iter < 100; iter++) {
    const dates = occupiedDates(residual);
    if (dates.length === 0) break;
    const cadences = estimate(dates);
    let bestAtom: TrainAtom | null = null;
    for (const target of dates) {
      const atoms = trainAtomsCovering(residual, target, cadences, ctx, mode);
      if (
        atoms.length &&
        (bestAtom === null || atoms[0].coverMass > bestAtom.coverMass)
      ) {
        bestAtom = atoms[0];
      }
    }
    if (bestAtom === null) break;
    components.push({
      kind: "UNIFORM",
      startDate: bestAtom.start,
      cadence: bestAtom.cadence,
      occurrences: bestAtom.occurrences,
      perTrancheAmount: bestAtom.perTrancheAmount,
      total: bestAtom.total,
    });
    const applied = applyAtom(residual, bestAtom);
    residual.clear();
    for (const [k, v] of applied) residual.set(k, v);
  }
  for (const d of occupiedDates(residual)) {
    const amt = residual.get(d as unknown as string) ?? 0;
    if (amt > EPSILON)
      components.push({ kind: "SINGLE_TRANCHE", date: d, amount: amt });
  }
  return components;
}

export { type EvaluationContext };
