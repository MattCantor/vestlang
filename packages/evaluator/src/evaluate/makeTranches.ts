import type {
  Blocker,
  ImpossibleBlocker,
  Installment,
  OCTDate,
  PeriodTag,
  ResolvedInstallment,
  UnresolvedBlocker,
  UnresolvedInstallment,
} from "@vestlang/types";
import { blockerToString } from "./blockerToString.js";
import { InstallmentSet } from "@vestlang/types";

/** The blockers, rendered as the comma-joined string each installment's meta carries. */
function renderBlockers(bs: Blocker[]): string {
  return bs.map(blockerToString).join(", ");
}

/**
 * Scaffold shared by the symbolic builders: one installment per amount, all
 * carrying the same `blockers`, with the per-index `meta` supplied by `metaAt`.
 * The resolved builder stays separate — it sets a top-level `date`, which the
 * symbolic installments never do.
 */
function makeSchedule(
  amounts: number[],
  blockers: Blocker[],
  metaAt: (i: number) => Installment["meta"],
): InstallmentSet {
  const installments = Array.from(
    { length: amounts.length },
    (_, i) => ({ amount: amounts[i], meta: metaAt(i) }) as Installment,
  );

  return { installments, blockers };
}

/* ------------------------
 * Resolved
 * ------------------------ */

export function makeResolvedInstallment(
  date: OCTDate,
  amount: number,
): ResolvedInstallment {
  return {
    amount,
    date,
    meta: { state: "RESOLVED" },
  };
}

export function makeResolvedSchedule(
  dates: OCTDate[],
  amounts: number[],
): InstallmentSet {
  const installments = dates.map((date, i) =>
    makeResolvedInstallment(date, amounts[i]),
  );
  return { installments, blockers: [] };
}

/* ------------------------
 * Impossible
 * ------------------------ */

export function makeImpossibleSchedule(
  amounts: number[],
  blockers: ImpossibleBlocker[],
): InstallmentSet {
  return makeSchedule(amounts, blockers, () => ({
    state: "IMPOSSIBLE",
    unresolved: renderBlockers(blockers),
  }));
}

/* ------------------------
 * Start Plus
 * ------------------------ */

export function makeStartPlusSchedule(
  amounts: number[],
  unit: PeriodTag,
  steplength: number,
  blockers: Blocker[],
): InstallmentSet {
  return makeSchedule(amounts, blockers, (i) => ({
    state: "UNRESOLVED",
    symbolicDate: { type: "START_PLUS", unit, steps: i * steplength },
    unresolved: renderBlockers(blockers),
  }));
}

/* ------------------------
 * Unresolved Vesting Start
 * ------------------------ */

export function makeUnresolvedVestingStartSchedule(
  amounts: number[],
  blockers: (UnresolvedBlocker | ImpossibleBlocker)[],
): InstallmentSet {
  return makeSchedule(amounts, blockers, () => ({
    state: "UNRESOLVED",
    symbolicDate: { type: "UNRESOLVED_VESTING_START" },
    unresolved: renderBlockers(blockers),
  }));
}

/* ------------------------
 * Unresolved Cliff
 * ------------------------ */

// Exported for the partial-LATER-OF fold in resolve/unresolved.ts, which builds
// the cliff installments itself rather than going through the schedule scaffold.
export function makeUnresolvedCliffInstallment(
  date: OCTDate,
  amount: number,
  blockers: (UnresolvedBlocker | ImpossibleBlocker)[],
): UnresolvedInstallment {
  return {
    amount,
    meta: {
      state: "UNRESOLVED",
      symbolicDate: { type: "UNRESOLVED_CLIFF", date },
      unresolved: renderBlockers(blockers),
    },
  };
}

export function makeUnresolvedCliffSchedule(
  dates: OCTDate[],
  amounts: number[],
  blockers: (UnresolvedBlocker | ImpossibleBlocker)[],
): InstallmentSet {
  return makeSchedule(
    amounts,
    blockers,
    (i) => makeUnresolvedCliffInstallment(dates[i], amounts[i], blockers).meta,
  );
}
