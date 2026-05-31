import { addMonthsRule, addDays } from "@vestlang/evaluator";
import type { OCTDate, VestingDayOfMonth } from "@vestlang/types";
import { minimalCtx, walk } from "./cadence.js";
import type {
  CliffUniformComponent,
  Component,
  SingleTrancheComponent,
  UniformComponent,
} from "./types.js";

const EPSILON = 1e-6;

function walkBack(
  from: OCTDate,
  cadence: { unit: "DAYS" | "MONTHS"; length: number },
  steps: number,
  policy: VestingDayOfMonth,
): OCTDate {
  const ctx = minimalCtx(policy);
  if (cadence.unit === "MONTHS") {
    return addMonthsRule(from, -cadence.length * steps, ctx);
  }
  return addDays(from, -cadence.length * steps);
}

export interface FoldResult {
  components: Component[];
  foldCount: number;
}

export function foldCliffs(
  components: Component[],
  policy: VestingDayOfMonth,
  grantDate: OCTDate | null,
): FoldResult {
  const ctx = minimalCtx(policy);
  // `null` means the caller didn't supply a grant date. Without one, the
  // before/after-grant distinction that separates a cliff from pre-grant accrual
  // doesn't exist, so the guard below is skipped and folding is purely
  // structural: a lump that is k whole installments before a matching train is a
  // cliff, and the vesting start is deduced by walking back k periods.
  const gKey = grantDate === null ? null : (grantDate as unknown as string);
  const singles = components.filter(
    (c): c is SingleTrancheComponent => c.kind === "SINGLE_TRANCHE",
  );
  const uniforms = components.filter(
    (c): c is UniformComponent => c.kind === "UNIFORM",
  );
  const others = components.filter(
    (c) => c.kind !== "SINGLE_TRANCHE" && c.kind !== "UNIFORM",
  );

  const usedSingles = new Set<SingleTrancheComponent>();
  const usedUniforms = new Set<UniformComponent>();
  const folded: CliffUniformComponent[] = [];

  for (const u of uniforms) {
    if (usedUniforms.has(u)) continue;
    for (const s of singles) {
      if (usedSingles.has(s)) continue;
      // A lump on or before the grant date is pre-grant accrual (handled by
      // foldPreGrant), not a cliff — a cliff lands strictly after the grant.
      // Only applies when a grant date was actually supplied (gKey !== null).
      if (gKey !== null && (s.date as unknown as string) <= gKey) continue;
      if (s.amount < u.perTrancheAmount - EPSILON) continue;

      const onePeriodAfter = walk(s.date, u.cadence, 1, ctx);
      if ((onePeriodAfter as unknown as string) !== (u.startDate as unknown as string)) {
        continue;
      }

      const ratio = s.amount / u.perTrancheAmount;
      const k = Math.round(ratio);
      if (k < 2) continue;
      if (Math.abs(ratio - k) > EPSILON) continue;

      const grantDate = walkBack(s.date, u.cadence, k, policy);

      folded.push({
        kind: "CLIFF_UNIFORM",
        grantDate,
        cadence: u.cadence,
        cliffSteps: k,
        tailOccurrences: u.occurrences,
        perTrancheAmount: u.perTrancheAmount,
      });
      usedSingles.add(s);
      usedUniforms.add(u);
      break;
    }
  }

  const remaining: Component[] = [
    ...others,
    ...uniforms.filter((u) => !usedUniforms.has(u)),
    ...singles.filter((s) => !usedSingles.has(s)),
    ...folded,
  ];

  return { components: remaining, foldCount: folded.length };
}
