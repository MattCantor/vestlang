import type { OCTDate, VestingDayOfMonth } from "@vestlang/types";
import { allocateVector } from "@vestlang/core";
import type { Cadence } from "./cadence.js";
import {
  EPSILON,
  type Residual,
  cadenceTracker,
  fingerprintFitsWithLeftover,
  gridRun,
  massAt,
  occupied,
  toResidual,
} from "./residual.js";
import type { Component, TrancheInput, UniformComponent } from "./types.js";

/** Max branches explored per decision node. Realistic schedules need few; this
 * caps pathological blow-up while staying optimal on clean inputs. */
const MAX_BRANCH = 16;
/** Hard cap on candidate cadences considered per residual, in estimator rank
 * order (data-derived modes first, then priors). */
const TOP_CADENCES = 5;

/** allocateVector fingerprints are monotonic in the total: increasing T never
 * decreases any position's share. So the set of T for which fingerprint <= mass
 * pointwise is a prefix [n, maxT]. Binary-search that maximal feasible T. */
function maxFeasibleTotal(mass: number[], n: number): number {
  const fitsAt = (T: number): boolean => {
    const fp = allocateVector(T, n);
    for (let k = 0; k < n; k++) {
      if (fp[k] - mass[k] > EPSILON) return false;
    }
    return true;
  };
  const hiInit = Math.round(mass.reduce((a, b) => a + b, 0));
  if (hiInit < n) return 0;
  if (fitsAt(hiInit)) return hiInit;
  let lo = n;
  let hi = hiInit;
  if (!fitsAt(lo)) return 0;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fitsAt(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
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

/** Generate candidate train atoms covering `target`.
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
  policy: VestingDayOfMonth,
): TrainAtom[] {
  const atoms: TrainAtom[] = [];

  for (const cadence of cadences) {
    const run = gridRun(residual, target, cadence, policy);

    for (let n = run.length; n >= 2; n--) {
      const positions = run.slice(0, n);
      const mass = positions.map((d) => massAt(residual, d));
      const sum = mass.reduce((a, b) => a + b, 0);

      // The train's total T must satisfy: allocateVector(T, n)[k] <= mass[k]
      // for every position k (so the leftover stays non-negative). Fingerprints are
      // monotonic in T, so there is a unique MAXIMAL feasible T — the train that
      // explains as much mass as possible while leaving only non-negative lumps.
      // Find it by binary search. We also keep T = sum (the pure-train hypothesis,
      // which fits exactly when the run has no coincident lump).
      const candidateTotals = new Set<number>();
      const maxT = maxFeasibleTotal(mass, n);
      if (maxT >= n) candidateTotals.add(maxT);
      if (Math.round(sum) >= n) candidateTotals.add(Math.round(sum));

      for (const total of candidateTotals) {
        const fp = allocateVector(total, n);
        if (!fingerprintFitsWithLeftover(fp, mass)) continue;
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
    const key = d;
    const v = (next.get(key) ?? 0) - atom.fingerprint[k];
    if (v <= EPSILON) next.delete(key);
    else next.set(key, v);
  });
  return next;
}

function atomToComponent(atom: TrainAtom): UniformComponent {
  return {
    kind: "UNIFORM",
    startDate: atom.start,
    cadence: atom.cadence,
    occurrences: atom.occurrences,
    perTrancheAmount: atom.perTrancheAmount,
    total: atom.total,
  };
}

export interface DecomposeResult {
  components: Component[];
  cadencesTried: string[];
}

/** Minimum-cardinality exact cover of the installment residual by UNIFORM trains
 * and SINGLE_TRANCHE pulses, via branch-and-bound. Trains must match the
 * cumulative round-down fingerprint, so jittery (rounded) trains are recognized
 * as single uniforms rather than fragmenting. Cliff folding happens downstream in
 * foldCliffs; this stage stays cliff-agnostic. */
export function decompose(
  tranches: TrancheInput[],
  policy: VestingDayOfMonth,
): DecomposeResult {
  const root = toResidual(tranches);

  // Per-residual cadence estimate (CLEAN-style): re-derive the candidate
  // dictionary from the *current* residual so a secondary cadence emerges once
  // the dominant train is peeled off. The tracker records every cadence
  // considered (capped at TOP_CADENCES per pass), so the reported `cadencesTried`
  // is the union across all passes.
  const tracker = cadenceTracker();
  const estimate = (dates: OCTDate[]): Cadence[] =>
    tracker.estimate(dates, TOP_CADENCES);

  // Greedy seed for an initial upper bound (also a valid answer if search is capped).
  const seed = greedyCover(root, estimate, policy);
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
    const dates = occupied(residual);
    if (dates.length === 0) {
      best = chosen.slice();
      bestCost = chosen.length;
      return;
    }

    const target = dates[0];
    const localRanked = estimate(dates);
    const atoms = trainAtomsCovering(
      residual,
      target,
      localRanked,
      policy,
    ).slice(0, MAX_BRANCH);

    // Branch: cover `target` with each candidate train.
    for (const atom of atoms) {
      const next = applyAtom(residual, atom);
      recurse(next, [...chosen, atomToComponent(atom)]);
    }

    // Branch: cover `target` as a lone pulse.
    {
      const next = new Map(residual);
      const amt = next.get(target) ?? 0;
      next.delete(target);
      recurse(next, [
        ...chosen,
        { kind: "SINGLE_TRANCHE", date: target, amount: amt },
      ]);
    }
  };

  recurse(root, []);

  return { components: best, cadencesTried: tracker.tried() };
}

/** Greedy fallback / upper-bound seed: repeatedly take the highest-mass fitting
 * train, then sweep leftovers into pulses. */
function greedyCover(
  root: Residual,
  estimate: (dates: OCTDate[]) => Cadence[],
  policy: VestingDayOfMonth,
): Component[] {
  const residual = new Map(root);
  const components: Component[] = [];
  for (let iter = 0; iter < 100; iter++) {
    const dates = occupied(residual);
    if (dates.length === 0) break;
    const cadences = estimate(dates);
    let bestAtom: TrainAtom | null = null;
    for (const target of dates) {
      const atoms = trainAtomsCovering(residual, target, cadences, policy);
      if (
        atoms.length &&
        (bestAtom === null || atoms[0].coverMass > bestAtom.coverMass)
      ) {
        bestAtom = atoms[0];
      }
    }
    if (bestAtom === null) break;
    components.push(atomToComponent(bestAtom));
    const applied = applyAtom(residual, bestAtom);
    residual.clear();
    for (const [k, v] of applied) residual.set(k, v);
  }
  for (const d of occupied(residual)) {
    const amt = massAt(residual, d);
    if (amt > EPSILON)
      components.push({ kind: "SINGLE_TRANCHE", date: d, amount: amt });
  }
  return components;
}
