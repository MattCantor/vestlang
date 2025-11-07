import type {
  Blocker,
  ImpossibleBlocker,
  ImpossibleInstallment,
  OCTDate,
  PeriodTag,
  ResolvedInstallment,
  UnresolvedBlocker,
  UnresolvedInstallment,
} from "@vestlang/types";
import { blockerToString } from "./blockerToString.js";
import { EvaluatedSchedule } from "../../../types/dist/evaluation.js";

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
): EvaluatedSchedule<ResolvedInstallment> {
  const installments: ResolvedInstallment[] = [];
  dates.forEach((date, i) =>
    installments.push(makeResolvedInstallment(date, amounts[i])),
  );
  return { installments, blockers: [] };
}

/* ------------------------
 * Impossible
 * ------------------------ */

function makeImpossibleInstallment(
  amount: number,
  blockers: ImpossibleBlocker[],
): ImpossibleInstallment {
  return {
    amount,
    meta: {
      state: "IMPOSSIBLE",
      unresolved: blockers.map(blockerToString).join(", "),
    },
  };
}

export function makeImpossibleSchedule(
  amounts: number[],
  blockers: ImpossibleBlocker[],
): EvaluatedSchedule<ImpossibleInstallment> {
  const installments = Array.from({ length: amounts.length }, (_, i) => {
    return makeImpossibleInstallment(amounts[i], blockers);
  });

  return {
    installments,
    blockers,
  };
}

/* ------------------------
 * Start Plus
 * ------------------------ */

function makeStartPlusInstallment(
  index: number,
  amount: number,
  unit: PeriodTag,
  stepLength: number,
  blockers: Blocker[],
): UnresolvedInstallment {
  return {
    amount,
    meta: {
      state: "UNRESOLVED",
      symbolicDate: {
        type: "START_PLUS",
        unit,
        steps: index * stepLength,
      },
      unresolved: blockers.map(blockerToString).join(", "),
    },
  };
}

export function makeStartPlusSchedule(
  amounts: number[],
  unit: PeriodTag,
  steplength: number,
  blockers: Blocker[],
): EvaluatedSchedule<UnresolvedInstallment> {
  const installments = Array.from({ length: amounts.length }, (_, i) => {
    return makeStartPlusInstallment(i, amounts[i], unit, steplength, blockers);
  });

  return {
    installments,
    blockers,
  };
}

/* ------------------------
 * Unresolved Vesting Start
 * ------------------------ */

function makeUnresolvedVestingStartInstallment(
  amount: number,
  blockers: (UnresolvedBlocker | ImpossibleBlocker)[],
): UnresolvedInstallment {
  return {
    amount,
    meta: {
      state: "UNRESOLVED",
      symbolicDate: { type: "UNRESOLVED_VESTING_START" },
      unresolved: blockers.map(blockerToString).join(", "),
    },
  };
}

export function makeUnresolvedVestingStartSchedule(
  amounts: number[],
  blockers: (UnresolvedBlocker | ImpossibleBlocker)[],
): EvaluatedSchedule<UnresolvedInstallment> {
  const installments = Array.from({ length: amounts.length }, (_, i) => {
    return makeUnresolvedVestingStartInstallment(amounts[i], blockers);
  });

  return {
    installments,
    blockers,
  };
}

/* ------------------------
 * Unresolved Cliff
 * ------------------------ */

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
      unresolved: blockers.map(blockerToString).join(", "),
    },
  };
}

export function makeUnresolvedCliffSchedule(
  dates: OCTDate[],
  amounts: number[],
  blockers: (UnresolvedBlocker | ImpossibleBlocker)[],
): EvaluatedSchedule<UnresolvedInstallment> {
  const installments = Array.from({ length: amounts.length }, (_, i) => {
    return makeUnresolvedCliffInstallment(dates[i], amounts[i], blockers);
  });

  return {
    installments,
    blockers,
  };
}
