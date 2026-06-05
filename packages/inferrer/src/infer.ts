import { stringify } from "@vestlang/render";
import type { OCTDate, Program, VestingDayOfMonth } from "@vestlang/types";
import { buildStatement } from "./atoms.js";
import { minimalCtx, walk } from "./cadence.js";
import { foldCliffs } from "./cliffFold.js";
import { splitCoincidentCliffs } from "./coincidentCliff.js";
import { foldPreGrant } from "./preGrantFold.js";
import { decompose } from "./pursuit.js";
import { POLICY_CANDIDATES } from "./policy.js";
import type {
  CliffUniformComponent,
  Component,
  InferInput,
  InferResult,
  SingleTrancheComponent,
  TrancheInput,
  UniformComponent,
} from "./types.js";
import { residualAgainstInput, type VerifyContext } from "./verify.js";

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

export function inferSchedule(input: InferInput): InferResult {
  if (input.tranches.length === 0) {
    throw new Error("inferSchedule: tranches must not be empty");
  }

  const sorted = sortInput(input.tranches);
  const totalQuantity = sorted.reduce((a, t) => a + t.amount, 0);
  const firstDate = sorted[0].date;
  const lastDate = sorted[sorted.length - 1].date;
  const grantDateKnown = input.grantDate !== undefined;
  const grantDate = input.grantDate ?? firstDate;

  let best: Attempt | null = null;
  const notes: string[] = [];

  // The day-of-month convention is either fixed to a provided hint or searched
  // over all candidates (a 1-policy vs full 32-policy search). The
  // winner-selection and explicit-list fallback below are identical regardless of
  // how many attempts there are — a wrong hint simply yields no clean fit and
  // falls back, rather than being silently widened.
  const policies: readonly VestingDayOfMonth[] = input.policy
    ? [input.policy]
    : POLICY_CANDIDATES;

  for (const policy of policies) {
    const attempt = runOne(
      sorted,
      policy,
      totalQuantity,
      grantDate,
      lastDate,
      grantDateKnown,
    );
    if (best === null) {
      best = attempt;
      continue;
    }
    const aSize = attempt.program.length;
    const bSize = best.program.length;
    if (attempt.residual < best.residual - 1e-9) {
      best = attempt;
    } else if (
      Math.abs(attempt.residual - best.residual) <= 1e-9 &&
      aSize < bSize
    ) {
      best = attempt;
    }
  }

  if (best === null) throw new Error("inferSchedule: no attempt succeeded");

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
        "matching-pursuit left nonzero residual; emitted explicit list fallback",
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
    .map(({ kind: _kind, ...rest }) => rest);
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
