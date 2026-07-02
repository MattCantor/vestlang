import type {
  OCTDate,
  PeriodTag,
  Program,
  VestingDayOfMonth,
} from "@vestlang/types";

export interface TrancheInput {
  date: OCTDate;
  amount: number;
}

export interface InferInput {
  tranches: TrancheInput[];
  grantDate?: OCTDate;
  /** Optional provenance hint. When provided, the day-of-month convention is
   * fixed instead of searched: the analytic core collapses its per-pattern
   * day-of-month candidate set to this one policy, trusted as ground truth.
   *
   * If a hint is wrong but still admits a projection-exact fit, the result is a
   * valid decomposition under that convention — which may be less sparse than the
   * unhinted search would find. We deliberately do not second-guess a fitting
   * decomposition; exact projection is the only correctness signal, and once two
   * conventions both reproduce the installments neither is "wrong" (the data
   * doesn't record which one made it). Provide a hint only when you know the
   * provenance. */
  policy?: VestingDayOfMonth;
}

/** The hypothesis family the analytic core recovered a statement under. Carried on
 * every decomposition component because it is NOT reconstructable from the DSL — a
 * pre-grant fold, for instance, emits plain- or cliff-shaped text. */
export type HypothesisFamily =
  | "plain"
  | "cliff"
  | "fold"
  | "then-segment"
  | "literal";

/** One component per emitted statement, tagged by the family that produced it and
 * carrying that statement's derived parameters. A THEN chain contributes one
 * `then-segment` per segment (the head plus each chained tail); the literal
 * per-date fallback contributes one `literal` per dated lump. */
export interface DecompositionComponent {
  tag: HypothesisFamily;
  /** The statement's vesting start (its FROM anchor). Null for a chained THEN tail,
   * which continues from the previous segment's end and carries no start of its own. */
  start: OCTDate | null;
  occurrences: number;
  period: { unit: PeriodTag; length: number };
  /** The statement's total shares — carried exactly, since cumulative round-down
   * makes the per-tranche amounts unequal so the total is not a clean multiple of
   * any single rate. */
  total: number;
  /** Cliff duration in the period's unit — present only when the statement carries
   * a cliff (the `cliff` family, or a `fold` that recovered an erased cliff). */
  cliffLength?: number;
}

// ---- build-input types for the atoms/emit layer ----------------------------------
// Not part of the public result shape (the decomposition is the tagged form above);
// these describe what the emitters hand to `buildStatement`.

export interface SingleTrancheComponent {
  kind: "SINGLE_TRANCHE";
  date: OCTDate;
  amount: number;
}

export interface CliffUniformComponent {
  kind: "CLIFF_UNIFORM";
  /** The vesting-start anchor placed directly as the emitted `FROM DATE` — an
   * erased-cliff fold rides its pre-grant anchor here too. */
  grantDate: OCTDate;
  cadence: { unit: PeriodTag; length: number };
  cliffSteps: number;
  tailOccurrences: number;
  /** Exact total shares for cliff + tail — the authoritative quantity read by
   * `buildCliffUniform` (rounding makes the per-tranche amounts unequal, so the
   * total is not a clean multiple of any single rate). */
  total: number;
  /** Cliff duration in the cadence's own unit, generalizing `cliffSteps ×
   * cadence.length` so an off-grid cliff (e.g. 5 months on an every-3-months
   * cadence) is expressible. */
  cliffLength: number;
}

export type Component = SingleTrancheComponent | CliffUniformComponent;

export interface InferResult {
  dsl: string;
  program: Program;
  decomposition: DecompositionComponent[];
  diagnostics: {
    /** Absolute per-date disagreement between the emitted program and the input —
     * 0 whenever a candidate verified, and also 0 on the literal fallback, which
     * is projection-lossless by construction. */
    residualError: number;
    totalQuantity: number;
    vestingDayOfMonth: VestingDayOfMonth;
    /** True when no hypothesis family verified and the literal per-date fallback
     * fired — the honest signal that the stream had no recognized template shape. */
    fallback: boolean;
    notes: string[];
  };
}
