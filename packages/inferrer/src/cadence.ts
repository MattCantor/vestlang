import {
  addDays,
  addMonthsRule,
  toDate,
  toISO,
} from "@vestlang/evaluator";
import type {
  EvaluationContext,
  OCTDate,
  PeriodTag,
  vesting_day_of_month,
} from "@vestlang/types";

export interface Cadence {
  unit: PeriodTag;
  length: number;
}

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

export function minimalCtx(
  policy: vesting_day_of_month,
): EvaluationContext {
  return {
    events: { grantDate: "1970-01-01" as OCTDate },
    grantQuantity: 0,
    asOf: "1970-01-01" as OCTDate,
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

export function rankCadences(dates: OCTDate[]): Cadence[] {
  if (dates.length < 2) return [...CADENCE_CANDIDATES];
  const sorted = [...dates].sort();
  const dayGaps: number[] = [];
  const monthGaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    dayGaps.push(dayDiff(sorted[i - 1], sorted[i]));
    monthGaps.push(monthDiff(sorted[i - 1], sorted[i]));
  }
  const scored = CADENCE_CANDIDATES.map((c) => {
    const gaps = c.unit === "MONTHS" ? monthGaps : dayGaps;
    const hits = gaps.filter((g) => g === c.length).length;
    return { cadence: c, hits };
  });
  scored.sort((a, b) => b.hits - a.hits);
  return scored.map((s) => s.cadence);
}

export { toISO };
