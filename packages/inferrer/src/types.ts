import type { PeriodTag, Program } from "@vestlang/types";
import type { OCTDate } from "@vestlang/types";
import type {
  AllocationType,
  VestingDayOfMonth,
} from "@vestlang/types";

export interface TrancheInput {
  date: OCTDate;
  amount: number;
}

export interface InferInput {
  tranches: TrancheInput[];
  grantDate?: OCTDate;
  /** Optional provenance hints. When provided, that dimension is fixed instead of
   * searched (both → 1×1, partial → narrowed, neither → full 32×6 search).
   *
   * A hint is trusted as ground truth and EXCLUDES other conventions from the
   * search. If a hint is wrong but still admits a residual-0 fit, the result is a
   * valid decomposition under the wrong convention — which may be less sparse than
   * a full search would find. (We deliberately do not second-guess a fitting
   * decomposition; residual is the only correctness signal, and once two
   * conventions both reproduce the installments, neither is "wrong" — the data
   * doesn't record which one made it.) Provide hints only when you know the
   * provenance. */
  policy?: VestingDayOfMonth;
  allocationType?: AllocationType;
}

export interface UniformComponent {
  kind: "UNIFORM";
  startDate: OCTDate;
  cadence: { unit: PeriodTag; length: number };
  occurrences: number;
  perTrancheAmount: number;
  /** Exact total shares for the train. For jittery (rounded) trains the per-tranche
   * amounts are unequal, so total !== perTrancheAmount * occurrences; this field
   * preserves the true total for faithful reconstruction. */
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
  perTrancheAmount: number;
}

export type Component =
  | UniformComponent
  | SingleTrancheComponent
  | CliffUniformComponent;

export interface InferResult {
  dsl: string;
  program: Program;
  decomposition: {
    uniforms: Array<Omit<UniformComponent, "kind">>;
    singles: Array<Omit<SingleTrancheComponent, "kind">>;
    cliffFolds: number;
    preGrantFolds: number;
  };
  diagnostics: {
    residualError: number;
    totalQuantity: number;
    vestingDayOfMonth: VestingDayOfMonth;
    allocationType: AllocationType;
    cadenceTried: string[];
    notes: string[];
  };
}
