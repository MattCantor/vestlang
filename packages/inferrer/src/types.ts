import type { PeriodTag, Program } from "@vestlang/types";
import type { OCTDate } from "@vestlang/types";
import type { VestingDayOfMonth } from "@vestlang/types";

export interface TrancheInput {
  date: OCTDate;
  amount: number;
}

export interface InferInput {
  tranches: TrancheInput[];
  grantDate?: OCTDate;
  /** Optional provenance hint. When provided, the day-of-month convention is
   * fixed instead of searched (→ 1-policy search; omitted → full candidate search).
   *
   * A hint is trusted as ground truth and EXCLUDES other conventions from the
   * search. If a hint is wrong but still admits a residual-0 fit, the result is a
   * valid decomposition under the wrong convention — which may be less sparse than
   * a full search would find. (We deliberately do not second-guess a fitting
   * decomposition; residual is the only correctness signal, and once two
   * conventions both reproduce the installments, neither is "wrong" — the data
   * doesn't record which one made it.) Provide a hint only when you know the
   * provenance. */
  policy?: VestingDayOfMonth;
}

export interface UniformComponent {
  kind: "UNIFORM";
  startDate: OCTDate;
  cadence: { unit: PeriodTag; length: number };
  occurrences: number;
  /** Representative per-tranche rate (the atom's fingerprint), used by the
   * fold/pursuit passes. Not exposed on the public decomposition: integer
   * allocation telescopes, so the rate alone can't reconstruct the train. */
  perTrancheAmount: number;
  /** Exact total shares for the train, and the authoritative quantity. Rounding
   * makes the per-tranche amounts unequal, so the total is not a clean multiple
   * of any single rate — this field preserves the true total for faithful
   * reconstruction. */
  total: number;
}

export interface SingleTrancheComponent {
  kind: "SINGLE_TRANCHE";
  date: OCTDate;
  amount: number;
}

export interface CliffUniformComponent {
  kind: "CLIFF_UNIFORM";
  grantDate: OCTDate;
  cadence: { unit: PeriodTag; length: number };
  cliffSteps: number;
  tailOccurrences: number;
  /** Write-only as of stage 2a: the constructors still populate it, but
   * `buildCliffUniform` now reads `total` instead of deriving from this rate.
   * Stage 2b reshapes the component wholesale, so it stays put for now. */
  perTrancheAmount: number;
  /** Exact total shares for cliff + tail — the authoritative quantity, mirroring
   * `UniformComponent.total`. Once rounding makes per-tranche amounts unequal the
   * total is no longer a clean multiple of any single rate, so it's carried
   * explicitly rather than reconstructed. */
  total: number;
  /** Cliff duration in the cadence's own unit — generalizing today's implicit
   * `cliffSteps × cadence.length` so a cliff off the installment grid can be
   * expressed (e.g. a 5-month cliff on an every-3-months cadence). */
  cliffLength: number;
}

export type Component =
  | UniformComponent
  | SingleTrancheComponent
  | CliffUniformComponent;

export interface InferResult {
  dsl: string;
  program: Program;
  decomposition: {
    uniforms: Array<Omit<UniformComponent, "kind" | "perTrancheAmount">>;
    singles: Array<Omit<SingleTrancheComponent, "kind">>;
    cliffFolds: number;
    preGrantFolds: number;
  };
  diagnostics: {
    residualError: number;
    totalQuantity: number;
    vestingDayOfMonth: VestingDayOfMonth;
    cadenceTried: string[];
    notes: string[];
  };
}
