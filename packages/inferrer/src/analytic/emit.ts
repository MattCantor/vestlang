// Typed emission for the analytic core. Every candidate is built as a normalized
// Statement (or a chain of them) — never string templating — so the DSL a
// consumer receives is the flat print of the exact AST the inferrer scored. The
// `CliffUniformComponent` carries an explicit `total` and an any-month
// `cliffLength`, so this layer can emit any month cliff length and a statement's
// true total.
//
// Anchors are placed DIRECTLY as `FROM DATE <start>`: the candidate carries the
// vesting start it derived and the emitted anchor names exactly that date. This
// is the only lossless choice for a month-end start — no calendar date walks back
// onto a day-31 anchor under VESTING_START_DAY(_MINUS_ONE). The emitted DSL
// carries no day-of-month — that's a runtime input the verifier passes as the
// evaluation context — so emission needs no policy.

import type {
  OCTDate,
  PeriodTag,
  Program,
  Statement,
  VestingDayOfMonth,
} from "@vestlang/types";
import { asChainedTail, buildStatement } from "../atoms.js";
import type { HypothesisFamily } from "../types.js";

/** A period unit + length. Lives here (the analytic module set) now that the old
 *  cadence-dictionary module is gone; the emit and family layers are its only
 *  users. */
export interface Cadence {
  unit: PeriodTag;
  length: number;
}

export interface Candidate {
  /** The typed, normalized program — rendered once by the verifier. */
  program: Program;
  /** The day-of-month the verifier evaluates this candidate under, and the value
   *  returned if it wins. Not encoded in the emitted DSL. */
  dom: VestingDayOfMonth;
  /** The candidate's vesting start, for the grant-alignment tiebreak. Null for a
   *  bare dated lump that carries no train anchor. */
  start: OCTDate | null;
  /** The hypothesis family that produced this candidate — threaded through to the
   *  tagged decomposition, since it is NOT reconstructable from the DSL (a
   *  pre-grant fold emits plain- or cliff-shaped text). */
  tag: HypothesisFamily;
}

/** A plain uniform train of `occurrences` at `cadence`, anchored directly at
 *  `anchor`, totalling `total`. */
export function plainUniformStmt(
  total: number,
  anchor: OCTDate,
  cadence: Cadence,
  occurrences: number,
): Statement {
  return buildStatement({
    kind: "PLAIN_UNIFORM",
    anchor,
    cadence,
    occurrences,
    total,
  });
}

/** A cliff train: a hold of `cliffLength` (any month count, off-grid allowed)
 *  before an `occurrences`-long grid at `cadence`, anchored directly at `anchor`.
 *  The cliffSteps/tailOccurrences split is immaterial to the emitted DSL —
 *  buildCliffUniform reads `total`, `cliffLength`, and only their sum
 *  (= occurrences) — so it's carried as a nominal 1 + (N-1). */
export function cliffStmt(
  total: number,
  anchor: OCTDate,
  cadence: Cadence,
  occurrences: number,
  cliffLength: number,
): Statement {
  return buildStatement({
    kind: "CLIFF_UNIFORM",
    // The anchor rides in `grantDate` — buildCliffUniform places it directly as
    // the vesting start, so a pre-grant (erased-cliff) anchor is expressible
    // here too. The `grantDate` field name is overloaded: it holds the
    // vesting-start anchor emitted as FROM DATE, pre-grant anchor included.
    grantDate: anchor,
    cadence,
    cliffSteps: 1,
    tailOccurrences: Math.max(occurrences - 1, 0),
    total,
    cliffLength,
  });
}

/** A bare dated lump: `amount VEST FROM DATE date`, no cadence. */
export function bareLumpStmt(amount: number, date: OCTDate): Statement {
  return buildStatement({ kind: "SINGLE_TRANCHE", date, amount });
}

/** A THEN chain: the head keeps its FROM anchor, each continuation is a chained
 *  tail (FROM dropped, cadence kept) that the evaluator grids on the chain
 *  origin's vesting day. Each `[total, cadence, occurrences]` is one segment. */
export function thenChainProgram(
  segments: { total: number; cadence: Cadence; occurrences: number }[],
  headAnchor: OCTDate,
): Program {
  return segments.map((seg, i) => {
    const stmt = plainUniformStmt(
      seg.total,
      headAnchor,
      seg.cadence,
      seg.occurrences,
    );
    // The tail's anchor is discarded by asChainedTail; only its periodicity is
    // kept, so the head anchor stands in harmlessly.
    return i === 0 ? stmt : asChainedTail(stmt);
  });
}
