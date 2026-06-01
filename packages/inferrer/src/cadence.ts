import { addDays, addMonthsRule, toDate, toISO } from "@vestlang/evaluator";
import type {
  EvaluationContext,
  OCTDate,
  PeriodTag,
  VestingDayOfMonth,
} from "@vestlang/types";

export interface Cadence {
  unit: PeriodTag;
  length: number;
}

/**
 * Curated cadence priors.
 *
 * NOTE: this is a *prior / fallback*, NOT the set of supported cadences. The
 * inferrer derives the actual period from the data (see `estimateCadences`);
 * this list is used only to (a) regularize sparse residuals where a gap mode is
 * unreliable, and (b) backstop a secondary cadence that isn't a dominant mode.
 * It always ranks below any data-derived candidate. Do NOT add an entry here to
 * "support" a new period — an every-N schedule is recognized from its gaps
 * without appearing in this list.
 */
export const CADENCE_CANDIDATES: readonly Cadence[] = [
  { unit: "DAYS", length: 1 },
  { unit: "DAYS", length: 7 },
  { unit: "DAYS", length: 14 },
  { unit: "MONTHS", length: 1 },
  { unit: "MONTHS", length: 3 },
  { unit: "MONTHS", length: 6 },
  { unit: "MONTHS", length: 12 },
];

export function cadenceKey(c: Cadence): string {
  return `${c.length} ${c.unit.toLowerCase()}`;
}

export function minimalCtx(policy: VestingDayOfMonth): EvaluationContext {
  return {
    events: { grantDate: "1970-01-01" },
    grantQuantity: 0,
    asOf: "1970-01-01",
    vesting_day_of_month: policy,
    allocation_type: "CUMULATIVE_ROUNDING",
  };
}

export function walk(
  from: OCTDate,
  cadence: Cadence,
  steps: number,
  ctx: EvaluationContext,
): OCTDate {
  if (cadence.unit === "MONTHS") {
    return addMonthsRule(from, cadence.length * steps, ctx);
  }
  return addDays(from, cadence.length * steps);
}

export function dayDiff(a: OCTDate, b: OCTDate): number {
  const ms = toDate(b).getTime() - toDate(a).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function monthDiff(a: OCTDate, b: OCTDate): number {
  const da = toDate(a);
  const db = toDate(b);
  return (
    (db.getUTCFullYear() - da.getUTCFullYear()) * 12 +
    (db.getUTCMonth() - da.getUTCMonth())
  );
}

/** Minimum number of agreeing gaps before a period is trusted as data-derived.
 * Below this we fall back to the priors, so irregular/bespoke data (no repeated
 * gap) reduces to a prior-only ranking — i.e. the pre-estimator behavior — and
 * two coincidentally-spaced one-offs are never merged into a spurious train. */
const MIN_GAP_SUPPORT_COUNT = 2;

interface GapMode {
  value: number;
  count: number;
  support: number; // count / nGaps
}

/** Distinct gap values with their support, ranked by support then by shortest
 * period (a fundamental outranks its harmonics on a tie). */
function modesOverN(gaps: number[], nGaps: number): GapMode[] {
  const counts = new Map<number, number>();
  for (const g of gaps) counts.set(g, (counts.get(g) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count, support: count / nGaps }))
    .sort((a, b) => b.support - a.support || a.value - b.value);
}

/**
 * Data-adaptive cadence estimation. Rather than scoring gaps against a fixed
 * list, let the data nominate the period: take the modal inter-event gap in the
 * cleaner of two lattices and synthesize a cadence at that period.
 *
 *  - MONTH lattice (calendar-month index via `monthDiff`): invariant to the
 *    `VestingDayOfMonth` convention — Jan 31 → Feb 28 → Mar 31 is a flat
 *    1, 1 here. Clean for the monthly family (monthly, every-2-month, ...).
 *  - DAY lattice (via `dayDiff`): clean for sub-monthly cadences that are not
 *    month-anchored (weekly/biweekly/daily).
 *
 * The dominant lattice (higher top-mode support) wins, so weekly data stays in
 * day-space and month-anchored data in month-space automatically. A gap value
 * must repeat (`count >= MIN_GAP_SUPPORT_COUNT`) before it is proposed;
 * otherwise we lean on the priors. `CADENCE_CANDIDATES` is appended as a
 * low-weight fallback, ranked below any data-derived candidate.
 *
 * Deterministic: pure function of the input dates (stable sorts, no clock/IO).
 */
export function estimateCadences(dates: OCTDate[]): Cadence[] {
  if (dates.length < 2) return [...CADENCE_CANDIDATES];

  const sorted = [...dates].sort();
  const dayGaps: number[] = [];
  const monthGaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    dayGaps.push(dayDiff(sorted[i - 1], sorted[i]));
    monthGaps.push(monthDiff(sorted[i - 1], sorted[i]));
  }
  const nGaps = dayGaps.length;

  // Same-month (0) month-gaps carry no period information; drop them.
  const monthModes = modesOverN(
    monthGaps.filter((g) => g >= 1),
    nGaps,
  );
  const dayModes = modesOverN(dayGaps, nGaps);
  const monthTop = monthModes[0]?.support ?? 0;
  const dayTop = dayModes[0]?.support ?? 0;

  const scored: { cadence: Cadence; score: number }[] = [];
  const seen = new Set<string>();
  const add = (cadence: Cadence, score: number) => {
    const key = cadenceKey(cadence);
    if (seen.has(key)) return;
    seen.add(key);
    scored.push({ cadence, score });
  };

  // Data-derived candidates from the dominant lattice (ties → month, the common
  // calendar case). A repeated gap scores far above any prior; the 1/length term
  // prefers a fundamental over its harmonics.
  if (monthTop >= dayTop) {
    for (const m of monthModes) {
      if (m.count < MIN_GAP_SUPPORT_COUNT) continue;
      add({ unit: "MONTHS", length: m.value }, 100 * m.support + 10 / m.value);
    }
  }
  if (dayTop >= monthTop) {
    for (const dm of dayModes) {
      if (dm.count < MIN_GAP_SUPPORT_COUNT) continue;
      add({ unit: "DAYS", length: dm.value }, 100 * dm.support + 10 / dm.value);
    }
  }

  // Curated priors: regularizer + fallback. Scored well below any data estimate,
  // but a gap-matching prior still sorts above a non-matching one.
  for (const c of CADENCE_CANDIDATES) {
    const gaps = c.unit === "MONTHS" ? monthGaps : dayGaps;
    const hits = gaps.filter((g) => g === c.length).length;
    add(c, hits * 0.5 + 0.001);
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.cadence.length - b.cadence.length ||
      (a.cadence.unit === b.cadence.unit
        ? 0
        : a.cadence.unit === "MONTHS"
          ? -1
          : 1),
  );
  return scored.map((s) => s.cadence);
}

export { toISO };
