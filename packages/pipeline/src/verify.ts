// Verify a proposed vesting schedule against dated observations — balance
// snapshots (a fiscal-year-end vested/unvested count) and exact tranches (a DEF
// 14A footnote: N shares vested on exactly this date). The schedule's own
// prediction at each observation date is the yardstick, and every supplied figure
// is graded against it.
//
// This targets SPARSE evidence — a handful of footnote tranches plus a couple of
// year-end balances. Reconstructing a full disclosed history is infer_schedule's
// job (stream in, exact DSL out); this one answers "does the schedule I already
// have match the little I can see?".
//
// It composes the pipeline's own reads rather than reaching into the engine:
// runEvaluate for the validity gate and absence disclosures, runAsOf for the
// balance predictions and the program-level unresolved/impossible totals, and
// runVestedBetween for the exact per-date tranche amounts.

import { daysBetween } from "@vestlang/primitives";
import type {
  AbsenceAssumption,
  OCTDate,
  ResolvedInstallment,
  VestingDayOfMonth,
} from "@vestlang/types";
import type { Result } from "./parse.js";
import { byDate } from "./summary.js";
import {
  runEvaluate,
  runAsOf,
  runVestedBetween,
  type GrantInput,
} from "./run.js";

/* ------------------------
 * Public input
 * ------------------------ */

// How close an observed figure must sit to the prediction to pass. One explicit
// setting, discriminated on unit — never two optional fields — so a caller states
// exactly one basis. `percent` is measured against the grant (the same
// percent-of-grant denominator the gaps use); `shares` is a raw count. Omitting
// tolerance entirely defaults to 5 percent-of-grant.
export type VerifyTolerance =
  | { kind: "percent"; value: number }
  | { kind: "shares"; value: number };

// A dated fact to check the schedule against. Two kinds, deliberately NOT sharing
// a shape:
//   - `balance` is a cumulative snapshot — vested and/or unvested shares as of a
//     date. At least one figure is meaningful; each supplied figure is its own
//     check. (Not named "event" — that word is the evaluation context's gate
//     firings.)
//   - `tranche` is a discrete release: `amount` shares vested on exactly `date`.
export type Observation =
  | { kind: "balance"; date: OCTDate; vested?: number; unvested?: number }
  | { kind: "tranche"; date: OCTDate; amount: number };

export interface VerifyInput {
  dsl: string;
  grant_date: OCTDate;
  // The percent-of-grant denominator, so it must be a positive share count.
  grant_quantity: number;
  events?: Record<string, OCTDate>;
  vesting_day_of_month?: VestingDayOfMonth;
  observations: Observation[];
  tolerance?: VerifyTolerance;
}

/* ------------------------
 * Public output
 * ------------------------ */

// One supplied figure graded against its prediction. `delta` is signed (observed
// beyond predicted is positive); `gap` is its magnitude as a percent of the grant
// (5.0 means 5%), the same units as a percent tolerance.
export interface FigureCheck {
  figure: "vested" | "unvested" | "tranche";
  predicted: number;
  observed: number;
  delta: number;
  gap: number;
  withinTolerance: boolean;
}

// A balance snapshot's verdict. Both predictions are reported regardless of which
// figures were supplied — a vested-only observation still shows what unvested the
// schedule expects — while `checks` covers only the figures actually given.
export interface BalanceRow {
  kind: "balance";
  date: OCTDate;
  predictedVested: number;
  predictedUnvested: number;
  checks: FigureCheck[];
  passes: boolean;
}

// The nearest predicted installment to a tranche date that had no installment of
// its own — enough to tell "off by a day" from "no such release." Omitted when
// the schedule has no dated installments to point at.
export interface NearestInstallment {
  date: OCTDate;
  amount: number;
}

// A tranche's verdict. The date is exact-match: a tranche on a date the schedule
// predicts nothing for fails outright (its check `withinTolerance` is false) and
// carries `nearest`.
export interface TrancheRow {
  kind: "tranche";
  date: OCTDate;
  check: FigureCheck;
  nearest?: NearestInstallment;
  passes: boolean;
}

export type VerificationRow = BalanceRow | TrancheRow;

export interface VerificationResult {
  // True only when every check across every row is within tolerance.
  matches: boolean;
  grantQuantity: number;
  // The tolerance actually applied — the default filled in when the caller omits it.
  tolerance: VerifyTolerance;
  rows: VerificationRow[];
  // Worst and mean absolute gap, as percent-of-grant, over the checks (not the
  // rows) — a two-figure balance contributes two data points.
  worstGap: number;
  meanGap: number;
  // Program-level share totals that carry no date: shares still pending an unfired
  // gate, and shares that can never vest. Both read as unvested from a filing's
  // point of view, so they don't enter the per-date predictions — they're
  // disclosed here instead.
  unresolved: number;
  impossible: number;
  // Events the resolves-to reading assumed stayed absent; a later or backdated
  // firing could move the answer. Relayed verbatim from the evaluator.
  absenceAssumptions: Array<AbsenceAssumption & { message: string }>;
}

export type VerifyResult = Result<VerificationResult>;

/* ------------------------
 * Grading
 * ------------------------ */

const DEFAULT_TOLERANCE: VerifyTolerance = { kind: "percent", value: 5 };

// Gap as a percent of the grant. Multiplying the share delta by 100 BEFORE
// dividing keeps a clean value exact (50 of 1000 is 5, not 4.999…), so a gap can
// be compared to a percent tolerance without a float wobble at the boundary.
const percentOfGrant = (shares: number, grantQuantity: number): number =>
  (Math.abs(shares) * 100) / grantQuantity;

const withinTolerance = (
  delta: number,
  gap: number,
  tolerance: VerifyTolerance,
): boolean =>
  tolerance.kind === "percent"
    ? gap <= tolerance.value
    : Math.abs(delta) <= tolerance.value;

// Build one figure-check. `predicted`/`observed` are share counts; the delta and
// gap fall out of them.
function figureCheck(
  figure: FigureCheck["figure"],
  predicted: number,
  observed: number,
  grantQuantity: number,
  tolerance: VerifyTolerance,
): FigureCheck {
  const delta = observed - predicted;
  const gap = percentOfGrant(delta, grantQuantity);
  return {
    figure,
    predicted,
    observed,
    delta,
    gap,
    withinTolerance: withinTolerance(delta, gap, tolerance),
  };
}

// The predicted installment closest to `date`, with an equidistant tie broken
// toward the earlier one. Returns undefined when there are no dated installments.
function nearestInstallment(
  date: OCTDate,
  dated: ResolvedInstallment[],
): NearestInstallment | undefined {
  let best: ResolvedInstallment | undefined;
  let bestDistance = Infinity;
  for (const inst of dated) {
    const distance = Math.abs(daysBetween(date, inst.date));
    // Strictly-closer wins; on a tie the earlier date wins, and `dated` is already
    // date-ordered, so the first at a given distance is the earlier one.
    if (distance < bestDistance) {
      best = inst;
      bestDistance = distance;
    }
  }
  return best ? { date: best.date, amount: best.amount } : undefined;
}

/* ------------------------
 * Observation splitting
 * ------------------------ */

// Same-date tranche observations are summed before comparison, mirroring how the
// engine folds same-date installments — so a footnote listing two releases on one
// day reads as one predicted-vs-disclosed check. Returns distinct dates in
// first-seen order.
function sumTranchesByDate(
  observations: Observation[],
): { date: OCTDate; amount: number }[] {
  const totals = new Map<OCTDate, number>();
  for (const o of observations) {
    if (o.kind === "tranche") {
      totals.set(o.date, (totals.get(o.date) ?? 0) + o.amount);
    }
  }
  return [...totals].map(([date, amount]) => ({ date, amount }));
}

/* ------------------------
 * The function
 * ------------------------ */

export function verifyObservations(input: VerifyInput): VerifyResult {
  const grantQuantity = input.grant_quantity;
  const tolerance = input.tolerance ?? DEFAULT_TOLERANCE;

  // Library-level guards, independent of the MCP layer's zod: grant quantity is
  // the percent-of-grant denominator, so it must be a positive count, and there's
  // nothing to grade against an empty observation set.
  if (!(grantQuantity >= 1)) {
    return {
      ok: false,
      error: {
        ruleId: "verify-invalid-grant-quantity",
        message: `grant quantity must be a positive share count (the percent-of-grant denominator); received ${grantQuantity}.`,
      },
    };
  }
  if (input.observations.length === 0) {
    return {
      ok: false,
      error: {
        ruleId: "verify-no-observations",
        message: "No observations to verify against; supply at least one.",
      },
    };
  }
  // A balance with neither figure would produce a row with zero checks — a
  // vacuous pass that grades nothing — so it's refused, not skipped.
  const emptyBalance = input.observations.findIndex(
    (o) =>
      o.kind === "balance" &&
      o.vested === undefined &&
      o.unvested === undefined,
  );
  if (emptyBalance !== -1) {
    return {
      ok: false,
      error: {
        ruleId: "verify-empty-balance",
        message: `Balance observation at index ${emptyBalance} (${input.observations[emptyBalance].date}) carries neither a vested nor an unvested figure; supply at least one.`,
      },
    };
  }

  const grant: GrantInput = {
    grant_date: input.grant_date,
    grant_quantity: grantQuantity,
    events: input.events,
    vesting_day_of_month: input.vesting_day_of_month,
  };

  // The gate. A parse or evaluation failure means there's nothing coherent to
  // compare against, so its refusal propagates verbatim. An over-allocating
  // program is graded as broken arithmetic: the percent-of-grant denominator and
  // the unvested = grant − vested identity both stop meaning anything once the
  // program claims more than the grant.
  const evaluated = runEvaluate(input.dsl, grant);
  if (!evaluated.ok) return evaluated;
  if (!evaluated.view.valid) {
    const detail = evaluated.view.findings
      .filter((f) => f.severity === "error")
      .map((f) => f.message)
      .join("; ");
    return {
      ok: false,
      error: {
        ruleId: "verify-over-allocation",
        message: `Cannot verify an over-allocating schedule: ${detail}.`,
      },
    };
  }

  // The dated installments the schedule predicts, for the nearest-tranche
  // pointer. A held or contradicted portion is not dated, so it isn't here — it
  // rides the unresolved/impossible totals below instead.
  const dated = evaluated.view.installments
    .filter((i): i is ResolvedInstallment => i.state === "RESOLVED")
    .sort(byDate);

  // Program-level totals. These carry no date (an unfired gate's shares have no
  // calendar position yet), and they're firing-independent of the as-of date, so
  // one read at the grant date suffices.
  const totals = runAsOf(input.dsl, grant, input.grant_date);
  if (!totals.ok) return totals;
  const unresolved = totals.unresolved;
  const impossible = totals.summary.total_impossible;

  const rows: VerificationRow[] = [];
  const checks: FigureCheck[] = [];

  // Balance rows: predicted vested is the RESOLVED shares on or before the date;
  // predicted unvested is the rest of the grant (pending and impossible shares
  // read as unvested from a filing's view). Both are reported; only the supplied
  // figures are checked.
  for (const o of input.observations) {
    if (o.kind !== "balance") continue;
    const asOf = runAsOf(input.dsl, grant, o.date);
    if (!asOf.ok) return asOf;
    const predictedVested = asOf.summary.total_vested;
    const predictedUnvested = grantQuantity - predictedVested;

    const rowChecks: FigureCheck[] = [];
    if (o.vested !== undefined) {
      rowChecks.push(
        figureCheck(
          "vested",
          predictedVested,
          o.vested,
          grantQuantity,
          tolerance,
        ),
      );
    }
    if (o.unvested !== undefined) {
      rowChecks.push(
        figureCheck(
          "unvested",
          predictedUnvested,
          o.unvested,
          grantQuantity,
          tolerance,
        ),
      );
    }
    checks.push(...rowChecks);
    rows.push({
      kind: "balance",
      date: o.date,
      predictedVested,
      predictedUnvested,
      checks: rowChecks,
      passes: rowChecks.every((c) => c.withinTolerance),
    });
  }

  // Tranche rows, one per distinct date (same-date observations already summed).
  // The date is exact-match: no predicted installment on it is a miss — the check
  // fails and the row points at the nearest release.
  for (const { date, amount } of sumTranchesByDate(input.observations)) {
    const window = runVestedBetween(input.dsl, grant, date, date);
    if (!window.ok) return window;
    const predicted = window.vested_in_window;
    const miss = predicted === 0;
    const check = figureCheck(
      "tranche",
      predicted,
      amount,
      grantQuantity,
      tolerance,
    );
    // Exact-match overrides the numeric tolerance: a release the schedule never
    // predicts on this date fails even if the disclosed count is small.
    if (miss) check.withinTolerance = false;
    checks.push(check);

    const nearest = miss ? nearestInstallment(date, dated) : undefined;
    rows.push({
      kind: "tranche",
      date,
      check,
      ...(nearest ? { nearest } : {}),
      passes: check.withinTolerance,
    });
  }

  // Chronological report; within a date, balances lead tranches (stable sort over
  // the balances-then-tranches build order).
  rows.sort(byDate);

  const absGaps = checks.map((c) => c.gap);
  const worstGap = absGaps.length ? Math.max(...absGaps) : 0;
  const meanGap = absGaps.length
    ? absGaps.reduce((a, g) => a + g, 0) / absGaps.length
    : 0;

  return {
    ok: true,
    matches: checks.every((c) => c.withinTolerance),
    grantQuantity,
    tolerance,
    rows,
    worstGap,
    meanGap,
    unresolved,
    impossible,
    absenceAssumptions: evaluated.view.absenceAssumptions,
  };
}
