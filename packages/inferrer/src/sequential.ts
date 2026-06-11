import { allocateVector } from "@vestlang/core";
import type {
  EvaluationContext,
  OCTDate,
  VestingDayOfMonth,
} from "@vestlang/types";
import { type Cadence, minimalCtx } from "./cadence.js";
import {
  EPSILON,
  type Residual,
  cadenceTracker,
  fingerprintMatchesExact,
  gridRun,
  massAt,
  occupied,
  toResidual,
  tryWalk,
  wholeMultiple,
} from "./residual.js";
import type {
  CliffUniformComponent,
  Component,
  TrancheInput,
  UniformComponent,
} from "./types.js";

/**
 * A sequential reading of the tranche stream: one schedule whose rate (and even
 * cadence) changes over time, laid out as back-to-back segments on a continuing
 * grid. This is the alternative to the decomposer's parallel-overlapping cover —
 * the cover always wins on component count, so the sequential partition has to be
 * built from scratch here rather than re-derived from it.
 */
export interface SequentialResult {
  components: Component[];
  /**
   * Per-segment flag: `true` marks a segment that continues the one before it
   * (the second segment onward of a chain). It's groundwork for emitting `THEN`
   * later; for now every segment is still rendered as its own dated statement and
   * the evaluator stitches them back together. Aligned 1:1 with `components`.
   */
  continuation: boolean[];
  /** Every cadence the estimator considered, for diagnostics. */
  cadencesTried: string[];
}

interface Run {
  cadence: Cadence;
  occurrences: number;
  perTrancheAmount: number;
  total: number;
  dates: OCTDate[];
}

/**
 * The longest run of equally-spaced tranches starting at `target` that a single
 * even-split train reproduces exactly. "Exactly" allows the off-by-one jitter
 * that cumulative round-down produces — e.g. 7 shares over 3 months vests
 * `2,2,3`, which is a clean uniform even though the amounts differ. We try each
 * candidate cadence, walk out the on-grid dates, and take the longest prefix
 * (length ≥ 2) whose even split lands on the observed amounts.
 */
function longestExactRun(
  r: Residual,
  target: OCTDate,
  cadences: Cadence[],
  ctx: EvaluationContext,
): Run | null {
  let best: Run | null = null;

  for (const cadence of cadences) {
    // Walk forward from `target` collecting consecutive on-grid dates that still
    // carry mass; the run can't extend past the first gap.
    const grid = gridRun(r, target, cadence, ctx);

    // Longest-first so the first exact prefix we find is the maximal one.
    for (let n = grid.length; n >= 2; n--) {
      const dates = grid.slice(0, n);
      const mass = dates.map((d) => massAt(r, d));
      const total = Math.round(mass.reduce((a, b) => a + b, 0));
      const fp = allocateVector(total, n);
      if (!fingerprintMatchesExact(fp, mass)) continue;

      if (best === null || n > best.occurrences) {
        best = {
          cadence,
          occurrences: n,
          perTrancheAmount: fp[0],
          total,
          dates,
        };
      }
      break; // maximal prefix for this cadence found; move to the next cadence
    }
  }

  return best;
}

interface HeadCliff {
  cliff: CliffUniformComponent;
  dates: OCTDate[];
}

/**
 * A cliff at the head of the schedule: the first `k` periods don't vest one at a
 * time, they land together as a single lump on the cliff date, after which a
 * normal train continues. The lump sits exactly one period before an equal-amount
 * run and is a whole multiple (`k ≥ 2`) of that run's per-period amount. We
 * recover the grant date by stepping back `k` periods from the lump — the same
 * structural read `foldCliffs` uses. Only the run's amount (not a jittery train)
 * can carry a cliff, since the cliff lump is `k ×` one period.
 */
function tryHeadCliff(
  r: Residual,
  lumpDate: OCTDate,
  cadences: Cadence[],
  ctx: EvaluationContext,
): HeadCliff | null {
  const lump = massAt(r, lumpDate);
  if (lump <= EPSILON) return null;

  for (const cadence of cadences) {
    const runStart = tryWalk(lumpDate, cadence, 1, ctx);
    if (runStart === null || massAt(r, runStart) <= EPSILON) continue;

    const run = longestExactRun(r, runStart, [cadence], ctx);
    if (!run) continue;
    // A cliff vests equal periods at once, so the tail must be an even train.
    if (
      Math.abs(run.total - run.perTrancheAmount * run.occurrences) > EPSILON
    ) {
      continue;
    }

    const { k, whole } = wholeMultiple(lump, run.perTrancheAmount);
    if (k < 2 || !whole) continue;

    const grantDate = tryWalk(lumpDate, cadence, -k, ctx);
    if (grantDate === null) continue;

    return {
      cliff: {
        kind: "CLIFF_UNIFORM",
        grantDate,
        cadence,
        cliffSteps: k,
        tailOccurrences: run.occurrences,
        perTrancheAmount: run.perTrancheAmount,
      },
      dates: [lumpDate, ...run.dates],
    };
  }

  return null;
}

/**
 * Read the stream as one schedule that changes rate over time.
 *
 * Walk left to right with a cursor that only moves forward: from the earliest
 * remaining tranche, take the longest equal-rate run that starts there, emit it,
 * then jump the cursor past it and repeat — re-estimating the cadence each time,
 * so a monthly head can hand off to a quarterly tail. The chain may open with a
 * cliff.
 *
 * Returns null (no sequential reading) whenever the stream isn't actually one
 * forward chain:
 *   - a tranche sits behind the cursor → it belongs to a second, interleaved
 *     grid that no single forward schedule can thread;
 *   - a tranche can't start a run or a head cliff → there's no clean rate to
 *     continue with;
 *   - only one segment comes out → that's just a plain train, which the ordinary
 *     decomposer already finds, so there's nothing new to offer.
 */
export function segmentSequential(
  tranches: TrancheInput[],
  policy: VestingDayOfMonth,
): SequentialResult | null {
  const ctx = minimalCtx(policy);
  const r = toResidual(tranches);
  const components: Component[] = [];
  const continuation: boolean[] = [];
  const tracker = cadenceTracker();

  // The earliest date the next segment is allowed to start on. Null until the
  // first segment is placed; afterwards it advances one period past each
  // segment's last installment, which is what keeps the walk strictly forward.
  let cursorMin: OCTDate | null = null;

  for (;;) {
    const dates = occupied(r);
    if (dates.length === 0) break;

    const target = dates[0];
    if (cursorMin !== null && target.localeCompare(cursorMin) < 0) {
      return null; // a tranche fell behind the cursor — interleaved grid
    }

    const cadences = tracker.estimate(dates);

    const run = longestExactRun(r, target, cadences, ctx);
    if (run) {
      const last = run.dates[run.dates.length - 1];
      components.push({
        kind: "UNIFORM",
        startDate: target,
        cadence: run.cadence,
        occurrences: run.occurrences,
        perTrancheAmount: run.perTrancheAmount,
        total: run.total,
      } satisfies UniformComponent);
      continuation.push(cursorMin !== null);
      for (const d of run.dates) r.delete(d);
      cursorMin = tryWalk(last, run.cadence, 1, ctx) ?? last;
      continue;
    }

    // A cliff is only recognized at the very head of the chain; a lump appearing
    // mid-chain (a cliff measured from a synthetic handoff) is out of scope.
    if (cursorMin === null) {
      const head = tryHeadCliff(r, target, cadences, ctx);
      if (head) {
        const last = head.dates[head.dates.length - 1];
        components.push(head.cliff);
        continuation.push(false);
        for (const d of head.dates) r.delete(d);
        cursorMin = tryWalk(last, head.cliff.cadence, 1, ctx) ?? last;
        continue;
      }
    }

    return null; // target can't open a run or a head cliff — not a chain
  }

  if (components.length < 2) return null;

  return { components, continuation, cadencesTried: tracker.tried() };
}
