import { addMonthsRule, addDays } from "@vestlang/evaluator";
import type { OCTDate, vesting_day_of_month } from "@vestlang/types";
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
  policy: vesting_day_of_month,
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
  policy: vesting_day_of_month,
): FoldResult {
  const ctx = minimalCtx(policy);
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
