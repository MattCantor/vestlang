import type { EvaluationContext, OCTDate } from "@vestlang/types";
import { type Cadence, cadenceKey, estimateCadences, walk } from "./cadence.js";
import type { TrancheInput } from "./types.js";

/** Tolerance for treating two share counts as equal. Integer allocation means
 * the real residual is never fractional, so this only absorbs floating-point
 * dust from sums and divisions — the whole inferrer shares the one value. */
export const EPSILON = 1e-6;

/** Mass remaining on each date, keyed by the date string. Both decomposers peel
 * atoms off a structure of exactly this shape. */
export type Residual = Map<OCTDate, number>;

export function toResidual(tranches: TrancheInput[]): Residual {
  const m: Residual = new Map();
  for (const t of tranches) m.set(t.date, (m.get(t.date) ?? 0) + t.amount);
  return m;
}

export const massAt = (r: Residual, d: OCTDate): number => r.get(d) ?? 0;

/** Dates that still carry mass, earliest first. */
export function occupied(r: Residual): OCTDate[] {
  return [...r.keys()]
    .filter((d) => massAt(r, d) > EPSILON)
    .sort((a, b) => a.localeCompare(b));
}

/** `walk`, but a degenerate (policy, date) pair returns null instead of throwing,
 * so a bad grid position just ends a run rather than crashing the segmenter. */
export function tryWalk(
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

/** Max steps walked out from a run's start before we give up — guards against a
 * pathological cadence walking forever on a degenerate grid. */
const MAX_RUN_STEPS = 600;

/** The maximal run of consecutive on-grid dates that begins at `target` and still
 * carries mass. The run ends at the first off-grid step (a `walk` that returns
 * null) or the first gap (a grid date with no mass). */
export function gridRun(
  r: Residual,
  target: OCTDate,
  cadence: Cadence,
  ctx: EvaluationContext,
): OCTDate[] {
  const run: OCTDate[] = [];
  for (let i = 0; ; i++) {
    const g = tryWalk(target, cadence, i, ctx);
    if (g === null || massAt(r, g) <= EPSILON) break;
    run.push(g);
    if (i > MAX_RUN_STEPS) break;
  }
  return run;
}

/**
 * The two decomposers ask different questions of an even-split train's
 * fingerprint, so they get two named predicates rather than one shared check —
 * unifying them would silently change one decomposer's behavior.
 *
 * Pursuit (parallel cover) wants a train that *fits with leftover*: every
 * position's allocated share must sit at or below the observed mass (so the
 * remainder stays non-negative) and be strictly positive (a real tranche). The
 * surplus is a coincident lump the cover peels off separately.
 */
export function fingerprintFitsWithLeftover(
  fingerprint: number[],
  mass: number[],
): boolean {
  for (let k = 0; k < fingerprint.length; k++) {
    if (fingerprint[k] - mass[k] > EPSILON || fingerprint[k] <= 0) return false;
  }
  return true;
}

/**
 * Sequential (forward chain) wants an *exact* match: the even split has to land
 * on the observed amounts position for position, with no leftover — a back-to-back
 * segment explains its run entirely or not at all.
 */
export function fingerprintMatchesExact(
  fingerprint: number[],
  mass: number[],
): boolean {
  return fingerprint.every((v, k) => Math.abs(v - mass[k]) <= EPSILON);
}

/** A `value / unit` ratio read as a whole multiple. Returns the rounded count `k`
 * and whether the ratio actually is that whole multiple (within EPSILON). Each
 * caller applies its own floor on `k` — a head cliff needs `k >= 2`, a coincident
 * split tolerates `k >= 1`. */
export function wholeMultiple(
  value: number,
  unit: number,
): { k: number; whole: boolean } {
  const ratio = value / unit;
  const k = Math.round(ratio);
  return { k, whole: Math.abs(ratio - k) <= EPSILON };
}

/** Records every cadence the estimator nominates across passes, so a decomposer
 * can re-estimate per residual yet still report the union it considered. */
export interface CadenceTracker {
  /** Estimate cadences for `dates` and fold them into the tracked set. With no
   * `limit`, returns the estimator's full ranking; with one, only the top slice
   * is returned (and recorded). */
  estimate(dates: OCTDate[], limit?: number): Cadence[];
  /** The keys of every cadence considered so far, for diagnostics. */
  tried(): string[];
}

export function cadenceTracker(): CadenceTracker {
  const triedKeys = new Set<string>();
  return {
    estimate(dates, limit) {
      const ranked = estimateCadences(dates);
      const chosen = limit === undefined ? ranked : ranked.slice(0, limit);
      for (const c of chosen) triedKeys.add(cadenceKey(c));
      return chosen;
    },
    tried: () => [...triedKeys],
  };
}
