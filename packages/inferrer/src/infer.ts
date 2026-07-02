import { stringify } from "@vestlang/render";
import type {
  OCTDate,
  Program,
  ResolutionStatus,
  VestingDayOfMonth,
} from "@vestlang/types";
import { DEFAULT_VESTING_DAY_OF_MONTH } from "@vestlang/types";
import { asChainedTail, buildStatement } from "./atoms.js";
import { walk } from "./cadence.js";
import { foldCliffs } from "./cliffFold.js";
import { splitCoincidentCliffs } from "./coincidentCliff.js";
import { foldPreGrant } from "./preGrantFold.js";
import { decompose } from "./pursuit.js";
import { InferInputError } from "./errors.js";
import { POLICY_CANDIDATES } from "./policy.js";
import { EPSILON } from "./residual.js";
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
  makeVerifyContext,
  programStatus,
  residualAgainstInput,
} from "./verify.js";

/** Strict tiebreak slack for comparing two candidates' residuals — finer than
 * EPSILON so a genuine residual difference is never flattened into a tie. */
const RESIDUAL_TIE_SLACK = 1e-9;

function sortInput(tranches: TrancheInput[]): TrancheInput[] {
  return [...tranches].sort((a, b) => a.date.localeCompare(b.date));
}

/** The date of a component's earliest installment — for a folded cliff, that's
 * the cliff date (cliffSteps periods after the walked-back vesting start). This
 * stays cliffSteps-derived rather than reading the component's `cliffLength`: it's
 * correct for everything stage 2a emits, since the folds only ever produce
 * on-cadence cliffs (where `cliffLength === cliffSteps × cadence.length`). Stage 2b
 * revisits this once off-cadence folds exist. */
function firstInstallmentDate(
  c: Component,
  policy: VestingDayOfMonth,
): OCTDate {
  if (c.kind === "SINGLE_TRANCHE") return c.date;
  if (c.kind === "UNIFORM") return c.startDate;
  return walk(c.grantDate, c.cadence, c.cliffSteps, policy);
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

interface AttemptBase {
  program: Program;
  components: Component[];
  foldCount: number;
  preGrantFolds: number;
  preGrantStarts: OCTDate[];
  residual: number;
  policy: VestingDayOfMonth;
  cadencesTried: string[];
}

/** Whether the attempt is the ordinary parallel cover or the sequential chain
 * decides which fields it carries. The sequential branch comes with a
 * program-level verdict already in hand: its residual is the product of a whole-
 * chain collapse, which hands the verdict back at the same time. The parallel
 * cover has no verdict yet — that gets computed lazily during selection. */
type Attempt =
  | (AttemptBase & { kind: "parallel" })
  | (AttemptBase & { kind: "sequential"; status: ResolutionStatus });

function runOne(
  sorted: TrancheInput[],
  policy: VestingDayOfMonth,
  totalQuantity: number,
  grantDate: OCTDate,
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
    ? foldPreGrant(sorted, reshaped, grantDate, totalQuantity, policy)
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

  const verifyCtx = makeVerifyContext(grantDate, totalQuantity, policy);
  const { residual } = residualAgainstInput(program, sorted, verifyCtx);

  return {
    kind: "parallel",
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
  const verifyCtx = makeVerifyContext(grantDate, totalQuantity, policy);
  const { residual, status } = collapseAgainstInput(program, sorted, verifyCtx);

  return {
    kind: "sequential",
    program,
    components: seq.components,
    foldCount: seq.components.filter((c) => c.kind === "CLIFF_UNIFORM").length,
    preGrantFolds: 0,
    preGrantStarts: [],
    residual,
    policy,
    cadencesTried: seq.cadencesTried,
    status,
  };
}

/** Rank of a collapse verdict for tiebreaking — higher is better. A schedule the
 * interchange can hold as one template beats a flat events-only list; anything
 * that doesn't even reproduce (unresolved/impossible) ranks last and is only ever
 * reached through the residual gate anyway. */
function verdictRank(status: ResolutionStatus): number {
  if (status === "template") return 2;
  if (status === "events-only") return 1;
  return 0;
}

/** How many statements carry their own explicit start. A THEN chain has one (the
 * head); an N-statement PLUS list has N. Fewer is better: the chained form reads
 * as one schedule and grids every segment on the chain origin's day (the grant's
 * one vesting day), which a list of written-down dates can't reproduce. */
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
): Attempt {
  const verdictOf = (a: Attempt): number => {
    if (a.residual >= EPSILON) return 0;
    const status =
      a.kind === "sequential"
        ? a.status
        : programStatus(
            a.program,
            makeVerifyContext(grantDate, totalQuantity, a.policy),
          );
    return verdictRank(status);
  };

  let best = attempts[0];
  let bestVerdict = verdictOf(best);
  for (let i = 1; i < attempts.length; i++) {
    const cur = attempts[i];
    if (cur.residual < best.residual - RESIDUAL_TIE_SLACK) {
      best = cur;
      bestVerdict = verdictOf(cur);
      continue;
    }
    if (cur.residual > best.residual + RESIDUAL_TIE_SLACK) continue;

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

/** Replace a winning attempt's per-statement residual with the one the consumer
 * path produces (a single program collapse). A sequential attempt already holds a
 * collapse residual, so it passes through untouched; only the parallel cover needs
 * the swap. The collapse also yields a verdict, but nothing downstream of the
 * winner reads it, so it's dropped rather than stashed back on the attempt. */
function rescoreOnCollapse(
  attempt: Attempt,
  sorted: TrancheInput[],
  grantDate: OCTDate,
  totalQuantity: number,
): Attempt {
  if (attempt.kind === "sequential") return attempt;
  const { residual } = collapseAgainstInput(
    attempt.program,
    sorted,
    makeVerifyContext(grantDate, totalQuantity, attempt.policy),
  );
  return { ...attempt, residual };
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
  const grantDateKnown = input.grantDate !== undefined;
  const grantDate = input.grantDate ?? firstDate;

  // Every surviving tranche is zero, so the residual layer would decompose an
  // empty date set into the empty program `[]` — which re-parses to nothing and
  // trips core's non-empty-statements assertion downstream. Short-circuit to a
  // single `0 VEST FROM DATE <earliest>` statement instead: a valid 1-statement
  // template that evaluates to an empty installment stream. The degenerate
  // program is exact by construction (total 0 → no installments to place), so
  // residual and total are set to 0 directly rather than re-derived through a
  // collapse — a deliberate verification-free exit.
  if (totalQuantity === 0) {
    const effectiveDayOfMonth = input.policy ?? DEFAULT_VESTING_DAY_OF_MONTH;
    const component: SingleTrancheComponent = {
      kind: "SINGLE_TRANCHE",
      date: firstDate,
      amount: 0,
    };
    const program: Program = [buildStatement(component, effectiveDayOfMonth)];
    const degenerateNotes: string[] = [
      "all tranches were zero; emitted a single zero-quantity statement",
    ];
    if (input.grantDate === undefined) {
      degenerateNotes.push(
        `grantDate defaulted to first tranche date (${firstDate})`,
      );
    }
    return {
      dsl: stringify(program),
      program,
      decomposition: {
        uniforms: [],
        singles: [{ date: firstDate, amount: 0 }],
        cliffFolds: 0,
        preGrantFolds: 0,
      },
      diagnostics: {
        residualError: 0,
        totalQuantity: 0,
        vestingDayOfMonth: effectiveDayOfMonth,
        cadenceTried: [],
        notes: degenerateNotes,
      },
    };
  }

  const notes: string[] = [];

  // The day-of-month convention is either fixed to a provided hint or searched
  // over all candidates (a 1-policy vs full candidate-set search). The
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
      runOne(sorted, policy, totalQuantity, grantDate, grantDateKnown),
    );
    const seq = runSequential(sorted, policy, totalQuantity, grantDate);
    if (seq !== null) attempts.push(seq);
  }

  if (attempts.length === 0) {
    throw new Error("inferSchedule: no attempt succeeded");
  }
  let best: Attempt = selectBest(attempts, grantDate, totalQuantity);

  // The per-statement residual on `best` was a search heuristic; the number we
  // report and gate on has to come from the collapse the consumer actually runs
  // (one joint allocateEvents walk plus the grant-date fold over all statements).
  // A parallel cover can score 0 statement-by-statement yet leave a residual once
  // its statements share a grid — exactly the asymmetry that let #144 ship behind
  // residualError: 0. The sequential candidate already carries a collapse residual,
  // so rescore only when it doesn't.
  best = rescoreOnCollapse(best, sorted, grantDate, totalQuantity);

  if (best.residual >= EPSILON) {
    const fallbackComponents = explicitListFallback(sorted);
    const fallbackProgram: Program = fallbackComponents.map((c) =>
      buildStatement(c, DEFAULT_VESTING_DAY_OF_MONTH),
    );
    const { residual: fallbackResidual } = collapseAgainstInput(
      fallbackProgram,
      sorted,
      makeVerifyContext(grantDate, totalQuantity, DEFAULT_VESTING_DAY_OF_MONTH),
    );
    if (fallbackResidual < best.residual) {
      notes.push(
        "exact-cover search left nonzero residual; emitted explicit list fallback",
      );
      best = {
        kind: "parallel",
        program: fallbackProgram,
        components: fallbackComponents,
        foldCount: 0,
        preGrantFolds: 0,
        preGrantStarts: [],
        residual: fallbackResidual,
        policy: DEFAULT_VESTING_DAY_OF_MONTH,
        cadencesTried: best.cadencesTried,
      };
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
