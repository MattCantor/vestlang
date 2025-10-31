import type {
  Blocker,
  ImpossibleBlocker,
  OCTDate,
  PeriodTag,
  ResolvedTranche,
  Tranche,
  UnresolvedBlocker,
  UnresolvedTranche,
} from "@vestlang/types";

export function makeImpossibleTranches(
  n: number,
  blockers: ImpossibleBlocker[],
): Tranche[] {
  return Array.from({ length: n }, () => ({
    amount: 0,
    meta: { state: "IMPOSSIBLE", blockers },
  }));
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
      blockers,
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
      date: { type: "BEFORE_VESTING_START" },
      blockers,
    },
  };
}
