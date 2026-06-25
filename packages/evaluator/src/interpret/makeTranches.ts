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
import { InstallmentSet } from "@vestlang/types";

/**
 * Scaffold shared by the symbolic builders: one installment per amount, all
 * carrying the same `blockers`, each built from its index by `installmentAt`.
 * The resolved builder stays separate — it sets a `date`, which the symbolic
 * installments never do.
 */
function makeSchedule(
  amounts: number[],
  blockers: Blocker[],
  installmentAt: (i: number, amount: number) => Installment,
): InstallmentSet {
  const installments = Array.from({ length: amounts.length }, (_, i) =>
    installmentAt(i, amounts[i]),
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
    state: "RESOLVED",
    amount,
    date,
  };
}

/* ------------------------
 * Impossible
 * ------------------------ */

export function makeImpossibleSchedule(
  amounts: number[],
  blockers: ImpossibleBlocker[],
): InstallmentSet {
  return makeSchedule(amounts, blockers, (_, amount) => ({
    state: "IMPOSSIBLE",
    amount,
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
  return makeSchedule(amounts, blockers, (i, amount) => ({
    state: "UNRESOLVED",
    amount,
    // The j-th occurrence (j from 1) lands at START + j periods, so the 0-based
    // array index i maps to (i + 1) * steplength — the same anchor convention the
    // resolved grid uses (gridDate / at(i + 1)). Counting from i alone would put
    // the first vest on the start date and shift every tranche a period early.
    symbolicDate: { type: "START_PLUS", unit, steps: (i + 1) * steplength },
  }));
}

/* ------------------------
 * Unresolved Vesting Start
 * ------------------------ */

export function makeUnresolvedVestingStartSchedule(
  amounts: number[],
  blockers: (UnresolvedBlocker | ImpossibleBlocker)[],
): InstallmentSet {
  return makeSchedule(amounts, blockers, (_, amount) => ({
    state: "UNRESOLVED",
    amount,
    symbolicDate: { type: "UNRESOLVED_VESTING_START" },
  }));
}

/* ------------------------
 * Unresolved Cliff
 * ------------------------ */

// The per-installment builder for an unresolved (held) cliff grid:
// makeUnresolvedCliffSchedule (below) lays out a whole grid of these, and the
// export lets makeTranches.test.ts pin one directly.
//
// `floor` (optional) is the cliff's disclosed lower bound — the earliest the
// tranche could land (a resolved `LATER OF` time-arm date). Threaded through to
// the symbolic date, with the key omitted when absent so a bare `CLIFF EVENT e`
// (no time arm, no known floor) carries no `floor`.
export function makeUnresolvedCliffInstallment(
  date: OCTDate,
  amount: number,
  floor?: OCTDate,
): UnresolvedInstallment {
  return {
    state: "UNRESOLVED",
    amount,
    symbolicDate: {
      type: "UNRESOLVED_CLIFF",
      date,
      ...(floor ? { floor } : {}),
    },
  };
}

export function makeUnresolvedCliffSchedule(
  dates: OCTDate[],
  amounts: number[],
  blockers: (UnresolvedBlocker | ImpossibleBlocker)[],
  floor?: OCTDate,
): InstallmentSet {
  return makeSchedule(amounts, blockers, (i, amount) =>
    makeUnresolvedCliffInstallment(dates[i], amount, floor),
  );
}
