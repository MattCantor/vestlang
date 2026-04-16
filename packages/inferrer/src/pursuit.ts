import type {
  EvaluationContext,
  OCTDate,
  vesting_day_of_month,
} from "@vestlang/types";
import {
  type Cadence,
  minimalCtx,
  rankCadences,
  walk,
} from "./cadence.js";
import type {
  Component,
  TrancheInput,
  UniformComponent,
} from "./types.js";

type Residual = Map<string, number>;

const EPSILON = 1e-6;

function toResidual(tranches: TrancheInput[]): Residual {
  const m = new Map<string, number>();
  for (const t of tranches) {
    const prev = m.get(t.date as unknown as string) ?? 0;
    m.set(t.date as unknown as string, prev + t.amount);
  }
  return m;
}

function sortedDates(r: Residual): OCTDate[] {
  return Array.from(r.keys())
    .sort()
    .map((s) => s as unknown as OCTDate);
}

interface Candidate {
  start: OCTDate;
  cadence: Cadence;
  occurrences: number;
  perTrancheAmount: number;
  score: number;
}

function findBestCandidate(
  residual: Residual,
  policy: vesting_day_of_month,
  topCadences: Cadence[],
): Candidate | null {
  const ctx = minimalCtx(policy);
  const dates = sortedDates(residual);
  if (dates.length < 2) return null;

  let best: Candidate | null = null;

  for (const cadence of topCadences) {
    for (const start of dates) {
      const startAmt = residual.get(start as unknown as string) ?? 0;
      if (startAmt <= EPSILON) continue;

      // Only accept pure runs — every position must have the same amount as
      // the start. This keeps the decomposer honest: a "bumpy" run (cliff
      // chunk on top of a uniform tail) doesn't get fitted as one noisy
      // uniform. The cliff case becomes a SINGLE_TRANCHE + UNIFORM pair
      // which the cliff fold-up can then rewrite.
      let occurrences = 0;
      while (true) {
        const grid = walk(start, cadence, occurrences, ctx);
        const amt = residual.get(grid as unknown as string);
        if (amt === undefined || amt <= EPSILON) break;
        if (Math.abs(amt - startAmt) > EPSILON) break;
        occurrences++;
        if (occurrences > 500) break;
      }

      if (occurrences < 2) continue;

      const score = startAmt * occurrences;

      if (best === null || score > best.score) {
        best = {
          start,
          cadence,
          occurrences,
          perTrancheAmount: startAmt,
          score,
        };
      }
    }
  }

  return best;
}

function subtract(
  residual: Residual,
  candidate: Candidate,
  policy: vesting_day_of_month,
): void {
  const ctx = minimalCtx(policy);
  for (let i = 0; i < candidate.occurrences; i++) {
    const grid = walk(candidate.start, candidate.cadence, i, ctx);
    const key = grid as unknown as string;
    const prev = residual.get(key) ?? 0;
    const next = prev - candidate.perTrancheAmount;
    if (next <= EPSILON) {
      residual.delete(key);
    } else {
      residual.set(key, next);
    }
  }
}

export interface DecomposeResult {
  components: Component[];
  cadencesTried: string[];
}

export function decompose(
  tranches: TrancheInput[],
  policy: vesting_day_of_month,
): DecomposeResult {
  const residual = toResidual(tranches);
  const components: Component[] = [];
  const cadencesTried = new Set<string>();

  const allDates = sortedDates(residual);
  const ranked = rankCadences(allDates);
  const topCadences = ranked.slice(0, 4);
  for (const c of topCadences) {
    cadencesTried.add(`${c.length} ${c.unit.toLowerCase()}`);
  }

  for (let iter = 0; iter < 20; iter++) {
    const best = findBestCandidate(residual, policy, topCadences);
    if (best === null) break;
    if (best.occurrences < 2) break;

    const uniform: UniformComponent = {
      kind: "UNIFORM",
      startDate: best.start,
      cadence: best.cadence,
      occurrences: best.occurrences,
      perTrancheAmount: best.perTrancheAmount,
    };
    components.push(uniform);
    subtract(residual, best, policy);
  }

  for (const date of sortedDates(residual)) {
    const amt = residual.get(date as unknown as string) ?? 0;
    if (amt > EPSILON) {
      components.push({ kind: "SINGLE_TRANCHE", date, amount: amt });
    }
  }

  return {
    components,
    cadencesTried: Array.from(cadencesTried),
  };
}

export { type EvaluationContext };
