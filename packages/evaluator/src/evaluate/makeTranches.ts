import type {
  Blocker,
  ImpossibleBlocker,
  ImpossibleTranche,
  OCTDate,
  PeriodTag,
  ResolvedTranche,
  UnresolvedBlocker,
  UnresolvedTranche,
} from "@vestlang/types";
import { blockerToString } from "./blockerToString.js";

export function makeImpossibleTranche(
  amount: number,
  blockers: ImpossibleBlocker[],
): ImpossibleTranche {
  return {
    amount,
    meta: {
      state: "IMPOSSIBLE",
      blockers: blockers.map(blockerToString).join(", "),
    },
  };
}

export function makeImpossibleTranches(
  amounts: number[],
  blockers: ImpossibleBlocker[],
): ImpossibleTranche[] {
  return Array.from({ length: amounts.length }, (_, i) => {
    return makeImpossibleTranche(amounts[i], blockers);
  });
}

export function makeStartPlusTranche(
  index: number,
  amount: number,
  unit: PeriodTag,
  stepLength: number,
  blockers: Blocker[],
): UnresolvedTranche {
  return {
    amount,
    meta: {
      state: "UNRESOLVED",
      date: {
        type: "START_PLUS",
        unit,
        steps: index * stepLength,
      },
      blockers: blockers.map(blockerToString).join(", "),
    },
  };
}

export function makeStartPlusTranches(
  amounts: number[],
  unit: PeriodTag,
  steplength: number,
  blockers: Blocker[],
): UnresolvedTranche[] {
  return Array.from({ length: amounts.length }, (_, i) => {
    return makeStartPlusTranche(i, amounts[i], unit, steplength, blockers);
  });
}

export function makeResolvedTranche(
  date: OCTDate,
  amount: number,
): ResolvedTranche {
  return {
    amount,
    date,
    meta: { state: "RESOLVED" },
  };
}

export function makeResolvedTranches(
  dates: OCTDate[],
  amounts: number[],
): ResolvedTranche[] {
  const tranches: ResolvedTranche[] = [];
  dates.forEach((date, i) =>
    tranches.push(makeResolvedTranche(date, amounts[i])),
  );
  return tranches;
}

export function makeBeforeVestingStartTranche(
  amount: number,
  blockers: (UnresolvedBlocker | ImpossibleBlocker)[],
): UnresolvedTranche {
  return {
    amount,
    meta: {
      state: "UNRESOLVED",
      date: { type: "UNRESOLVED_VESTING_START" },
      blockers: blockers.map(blockerToString).join(", "),
    },
  };
}

export function makeBeforeCliffTranche(
  date: OCTDate,
  amount: number,
  blockers: (UnresolvedBlocker | ImpossibleBlocker)[],
): UnresolvedTranche {
  return {
    amount,
    meta: {
      state: "UNRESOLVED",
      date: { type: "UNRESOLVED_CLIFF", date },
      blockers: blockers.map(blockerToString).join(", "),
    },
  };
}

export function makeBeforeCliffTranches(
  dates: OCTDate[],
  amounts: number[],
  blockers: (UnresolvedBlocker | ImpossibleBlocker)[],
): UnresolvedTranche[] {
  return Array.from({ length: amounts.length }, (_, i) => {
    return makeBeforeCliffTranche(dates[i], amounts[i], blockers);
  });
}
