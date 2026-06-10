import { stringify } from "@vestlang/render";
import type {
  OCTDate,
  Program,
  Status,
  VestingDayOfMonth,
} from "@vestlang/types";
import { asChainedTail, buildStatement } from "./atoms.js";
import { minimalCtx, walk } from "./cadence.js";
import { foldCliffs } from "./cliffFold.js";
import { splitCoincidentCliffs } from "./coincidentCliff.js";
import { foldPreGrant } from "./preGrantFold.js";
import { decompose } from "./pursuit.js";
import { InferInputError } from "./errors.js";
import { POLICY_CANDIDATES } from "./policy.js";
import { segmentSequential } from "./sequential.js";
import type {
  CliffUniformComponent,
  Component,
  InferInput,
  InferResult,
  SingleTrancheComponent,
  TrancheInput,
  UniformComponent,
} from "./types.js";
import {
  collapseAgainstInput,
  programStatus,
  residualAgainstInput,
  type VerifyContext,
} from "./verify.js";

function sortInput(tranches: TrancheInput[]): TrancheInput[] {
  return [...tranches].sort((a, b) => a.date.localeCompare(b.date));
}

/** The date of a component's earliest installment — for a folded cliff, that's
 * the cliff date (cliffSteps periods after the walked-back vesting start). */
function firstInstallmentDate(
  c: Component,
  policy: VestingDayOfMonth,
): OCTDate {
  if (c.kind === "SINGLE_TRANCHE") return c.date;
  if (c.kind === "UNIFORM") return c.startDate;
  return walk(c.grantDate, c.cadence, c.cliffSteps, minimalCtx(policy));
}

/** Emit components in cursor-chain order: each segment's first installment is
 * non-decreasing, so an abutting head (e.g. a folded cliff) precedes the tail it
 * continues into. The evaluator's continuation check folds such a chain into one
 * template; out of order, it would read the head as a separate overlapping grid.
 * Safe regardless of whether the segments actually abut — a non-abutting handoff
 * simply stays events-only. */
function orderByCursorChain(
  components: Component[],
  policy: VestingDayOfMonth,
): Component[] {
  return [...components].sort((a, b) =>
    firstInstallmentDate(a, policy).localeCompare(
      firstInstallmentDate(b, policy),
    ),
  );
}

function explicitListFallback(sorted: TrancheInput[]): Component[] {
  return sorted.map(
    (t): SingleTrancheComponent => ({
      kind: "SINGLE_TRANCHE",
      date: t.date,
      amount: t.amount,
    }),
  );
}

interface Attempt {
  program: Program;
  components: Component[];
  foldCount: number;
  preGrantFolds: number;
  preGrantStarts: OCTDate[];
  residual: number;
  policy: VestingDayOfMonth;
  cadencesTried: string[];
  /** Per-segment continuation flags for a sequential attempt — the marked tails
   * are emitted as `THEN`. Absent for the ordinary parallel cover. */
  continuation?: boolean[];
  /** Program-level verdict, precomputed for the sequential attempt (its residual
   * already comes from a collapse, which hands the verdict back at the same time).
   * Absent for the parallel cover, whose verdict is computed lazily during
   * selection. */
  status?: Status;
}

function runOne(
  sorted: TrancheInput[],
  policy: VestingDayOfMonth,
  totalQuantity: number,
  grantDate: OCTDate,
  asOf: OCTDate,
  grantDateKnown: boolean,
): Attempt {
  const { components, cadencesTried } = decompose(sorted, policy);
  // Under CRD, decompose emits a cliff as a coincident lump on a train (a pulse
  // sharing the train's first date) rather than a lump one period before it. The
  // fold passes only recognize the latter, so normalize the former into it first;
  // otherwise the cliff never folds and reads as two overlapping grids.
  const reshaped = splitCoincidentCliffs(components, policy);
  // foldPreGrant answers "did vesting start before the grant date?" — a question
  // that is unanswerable without a real grant date. When none was supplied (the
  // grant date was defaulted to the first tranche), skip it entirely: detecting
  // "pre-grant accrual" against an invented grant date is incoherent, and the
  // honest reading of bare tranches is the structural one (deduce the vesting
  // start from the cliff's shape). The more context supplied, the more structure
  // the inferrer can separate — a cliff from pre-grant accrual being the case in
  // point, since the two are numerically identical until a grant date splits them.
  const pg = grantDateKnown
    ? foldPreGrant(sorted, reshaped, grantDate, totalQuantity, asOf, policy)
    : { components: reshaped, foldCount: 0, vestingStarts: [] as OCTDate[] };
  const { components: folded, foldCount } = foldCliffs(
    pg.components,
    policy,
    grantDateKnown ? grantDate : null,
  );
  // Emit in cursor-chain order so a folded cliff head precedes its tail; the
  // evaluator only chains abutting statements that arrive in cursor order.
  const ordered = orderByCursorChain(folded, policy);
  const program: Program = ordered.map((c) => buildStatement(c, policy));

  const verifyCtx: VerifyContext = {
    grantDate,
    totalQuantity,
    asOf,
    vestingDayOfMonth: policy,
  };
  const { residual } = residualAgainstInput(program, sorted, verifyCtx);

  return {
    program,
    components: folded,
    foldCount,
    preGrantFolds: pg.foldCount,
    preGrantStarts: pg.vestingStarts,
    residual,
    policy,
    cadencesTried,
  };
}

/** Build the sequential (one-schedule-whose-rate-changes) candidate for a policy,
 * or null if the stream isn't a forward chain. Runs alongside `runOne` and
 * competes in the same selection. */
function runSequential(
  sorted: TrancheInput[],
  policy: VestingDayOfMonth,
  totalQuantity: number,
  grantDate: OCTDate,
  asOf: OCTDate,
): Attempt | null {
  const seq = segmentSequential(sorted, policy);
  if (seq === null) return null;

  // The segments are produced in cursor order already, so no re-sort is needed.
  // Each continuation segment is emitted as a THEN tail (no FROM date); the head
  // keeps its own start. A chained tail can't be evaluated on its own, so this
  // program is scored by collapsing the whole chain rather than statement by
  // statement.
  const program: Program = seq.components.map((c, i) => {
    const stmt = buildStatement(c, policy);
    return seq.continuation[i] ? asChainedTail(stmt) : stmt;
  });
  const verifyCtx: VerifyContext = {
    grantDate,
    totalQuantity,
    asOf,
    vestingDayOfMonth: policy,
  };
  const { residual, status } = collapseAgainstInput(program, sorted, verifyCtx);

  return {
    program,
    components: seq.components,
    foldCount: seq.components.filter((c) => c.kind === "CLIFF_UNIFORM").length,
    preGrantFolds: 0,
    preGrantStarts: [],
    residual,
    policy,
    cadencesTried: seq.cadencesTried,
    continuation: seq.continuation,
    status,
  };
}

/** Rank of a collapse verdict for tiebreaking — higher is better. A schedule the
 * interchange can hold as one template beats a flat events-only list; anything
 * that doesn't even reproduce (unresolved/impossible) ranks last and is only ever
 * reached through the residual gate anyway. */
function verdictRank(status: string): number {
  if (status === "template") return 2;
  if (status === "events-only") return 1;
  return 0;
}

/** How many statements carry their own explicit start. A THEN chain has one (the
 * head); an N-statement PLUS list has N. Fewer is better: the chained form reads
 * as one schedule and computes its handoffs from the chain origin, so it can't
 * miss a clamped month-end the way a written-down date can. */
function explicitStarts(program: Program): number {
  return program.filter((s) => !s.chained).length;
}

/**
 * Pick the winning attempt by a strict, in-order tiebreak:
 *   1. smallest residual — a hard gate, so a candidate that doesn't reproduce the
 *      stream exactly never wins on the strength of a nicer shape;
 *   2. best verdict (template over events-only) — recovering a reusable schedule
 *      is the whole point, so it outranks a shorter flat decomposition;
 *   3. shortest program — fewest statements among equally-good candidates;
 *   4. fewest explicit starts — the THEN chain over the abutting PLUS list when
 *      they're otherwise tied (same residual, verdict, and length).
 * Equal on all four keeps the earlier attempt, so adding the sequential candidate
 * never disturbs a case the parallel cover already handled identically.
 *
 * The verdict needs a program-collapse call; the sequential attempt already has
 * one (stored on it), and for the rest we only spend the call on candidates that
 * clear the residual gate (the others can't win on residual regardless).
 */
function selectBest(
  attempts: Attempt[],
  grantDate: OCTDate,
  totalQuantity: number,
  asOf: OCTDate,
): Attempt {
  const verdictOf = (a: Attempt): number => {
    if (a.residual >= 1e-6) return 0;
    const status =
      a.status ??
      programStatus(a.program, {
        grantDate,
        totalQuantity,
        asOf,
        vestingDayOfMonth: a.policy,
      });
    return verdictRank(status);
  };

  let best = attempts[0];
  let bestVerdict = verdictOf(best);
  for (let i = 1; i < attempts.length; i++) {
    const cur = attempts[i];
    if (cur.residual < best.residual - 1e-9) {
      best = cur;
      bestVerdict = verdictOf(cur);
      continue;
    }
    if (cur.residual > best.residual + 1e-9) continue;

    const curVerdict = verdictOf(cur);
    if (curVerdict !== bestVerdict) {
      if (curVerdict > bestVerdict) {
        best = cur;
        bestVerdict = curVerdict;
      }
      continue;
    }

    // Same residual and verdict: prefer the shorter program, then the one with
    // fewer explicit starts (the THEN chain over the equivalent PLUS list).
    if (cur.program.length < best.program.length) {
      best = cur;
    } else if (
      cur.program.length === best.program.length &&
      explicitStarts(cur.program) < explicitStarts(best.program)
    ) {
      best = cur;
    }
  }
  return best;
}

export function inferSchedule(input: InferInput): InferResult {
  if (input.tranches.length === 0) {
    throw new InferInputError("tranches must not be empty");
  }
  input.tranches.forEach((t, i) => {
    if (!Number.isInteger(t.amount) || t.amount < 0) {
      throw new InferInputError(
        `tranche amounts must be non-negative integers (got ${t.amount} at index ${i})`,
      );
    }
  });

  const sorted = sortInput(input.tranches);
  const totalQuantity = sorted.reduce((a, t) => a + t.amount, 0);
  const firstDate = sorted[0].date;
  const lastDate = sorted[sorted.length - 1].date;
  const grantDateKnown = input.grantDate !== undefined;
  const grantDate = input.grantDate ?? firstDate;

  const notes: string[] = [];

  // The day-of-month convention is either fixed to a provided hint or searched
  // over all candidates (a 1-policy vs full 32-policy search). The
  // winner-selection and explicit-list fallback below are identical regardless of
  // how many attempts there are — a wrong hint simply yields no clean fit and
  // falls back, rather than being silently widened.
  const policies: readonly VestingDayOfMonth[] = input.policy
    ? [input.policy]
    : POLICY_CANDIDATES;

  // Each policy yields the ordinary parallel cover and, when the stream reads as
  // one forward chain, a sequential alternative. The cover is pushed first so a
  // tie resolves in its favor — the sequential candidate only ever displaces it
  // by genuinely doing better (recovering a template the cover couldn't).
  const attempts: Attempt[] = [];
  for (const policy of policies) {
    attempts.push(
      runOne(
        sorted,
        policy,
        totalQuantity,
        grantDate,
        lastDate,
        grantDateKnown,
      ),
    );
    const seq = runSequential(
      sorted,
      policy,
      totalQuantity,
      grantDate,
      lastDate,
    );
    if (seq !== null) attempts.push(seq);
  }

  if (attempts.length === 0) {
    throw new Error("inferSchedule: no attempt succeeded");
  }
  let best: Attempt = selectBest(attempts, grantDate, totalQuantity, lastDate);

  if (best.residual >= 1e-6) {
    const fallbackComponents = explicitListFallback(sorted);
    const fallbackProgram: Program = fallbackComponents.map((c) =>
      buildStatement(c, "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH"),
    );
    const fallbackAttempt: Attempt = {
      program: fallbackProgram,
      components: fallbackComponents,
      foldCount: 0,
      preGrantFolds: 0,
      preGrantStarts: [],
      residual: 0,
      policy: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
      cadencesTried: best.cadencesTried,
    };
    const { residual: fallbackResidual } = residualAgainstInput(
      fallbackProgram,
      sorted,
      {
        grantDate,
        totalQuantity,
        asOf: lastDate,
        vestingDayOfMonth: fallbackAttempt.policy,
      },
    );
    if (fallbackResidual < best.residual) {
      notes.push(
        "exact-cover search left nonzero residual; emitted explicit list fallback",
      );
      best = { ...fallbackAttempt, residual: fallbackResidual };
    }
  }

  if (input.grantDate === undefined) {
    notes.push(`grantDate defaulted to first tranche date (${firstDate})`);
  }

  for (const start of best.preGrantStarts) {
    notes.push(
      `lump on grant date ${grantDate} reinterpreted as vesting start ${start} (pre-grant accrual)`,
    );
  }

  const uniforms = best.components
    .filter((c): c is UniformComponent => c.kind === "UNIFORM")
    .map(
      ({ kind: _kind, perTrancheAmount: _perTrancheAmount, ...rest }) => rest,
    );
  const singles = best.components
    .filter((c): c is SingleTrancheComponent => c.kind === "SINGLE_TRANCHE")
    .map(({ kind: _kind, ...rest }) => rest);
  const cliffFolds = best.components.filter(
    (c): c is CliffUniformComponent => c.kind === "CLIFF_UNIFORM",
  ).length;

  return {
    dsl: stringify(best.program),
    program: best.program,
    decomposition: {
      uniforms,
      singles,
      cliffFolds,
      preGrantFolds: best.preGrantFolds,
    },
    diagnostics: {
      residualError: best.residual,
      totalQuantity,
      vestingDayOfMonth: best.policy,
      cadenceTried: best.cadencesTried,
      notes,
    },
  };
}
