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
    symbolicDate: { type: "START_PLUS", unit, steps: i * steplength },
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

// Exported for the partial-LATER-OF fold in resolve/unresolved.ts, which builds
// the cliff installments itself rather than going through the schedule scaffold.
// The caller carries the blockers on the surrounding InstallmentSet.
export function makeUnresolvedCliffInstallment(
  date: OCTDate,
  amount: number,
): UnresolvedInstallment {
  return {
    state: "UNRESOLVED",
    amount,
    symbolicDate: { type: "UNRESOLVED_CLIFF", date },
  };
}

export function makeUnresolvedCliffSchedule(
  dates: OCTDate[],
  amounts: number[],
  blockers: (UnresolvedBlocker | ImpossibleBlocker)[],
): InstallmentSet {
  return makeSchedule(amounts, blockers, (i, amount) =>
    makeUnresolvedCliffInstallment(dates[i], amount),
  );
}
