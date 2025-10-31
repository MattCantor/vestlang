import type {
  Blocker,
  EvaluationContext,
  OCTDate,
  PeriodTag,
  ResolvedTranche,
  UnresolvedTranche,
  VestingNode,
} from "@vestlang/types";
import {
  isPickedResolved,
  type PickedResolved,
  type PickedUnresolved,
  probeLaterOf,
  type ScheduleWithCliff,
} from "./utils.js";
import { eq, lt } from "./time.js";
import { evaluateVestingNodeExpr } from "./selectors.js";
import {
  makeBeforeCliffTranche,
  makeBeforeCliffTranches,
  makeImpossibleTranches,
  makeResolvedTranche,
  makeStartPlusTranche,
  makeStartPlusTranches,
} from "./makeTranches.js";

export function evaluateCliff(
  resSchedule: PickedResolved<ScheduleWithCliff>,
  dates: OCTDate[],
  amounts: number[],
  ctx: EvaluationContext,
) {
  // Prepare ctx and check if the cliff is resolved
  const overlayCtx: EvaluationContext = {
    ...ctx,
    events: { ...ctx.events, vestingStart: resSchedule.meta.date },
  };

  const vestingPeriod = resSchedule.picked.periodicity;
  const resCliff = evaluateVestingNodeExpr(vestingPeriod.cliff, overlayCtx);

  // impossible cliff
  if (resCliff.type === "IMPOSSIBLE")
    return makeImpossibleTranches(dates.length, resCliff.blockers);

  // unresolved cliff and no best of LATER_OF selector
  if (resCliff.type === "UNRESOLVED")
    return makeBeforeCliffTranches(amounts, resCliff.blockers);

  // Resolved Cliff
  if (isPickedResolved(resCliff))
    return evaluateResolvedCliff(dates, amounts, resCliff.meta.date);

  // Unresolved Cliff with best of LATER_OF selector
  const blockers = (resCliff as PickedUnresolved<VestingNode>).meta.blockers;
  if (vestingPeriod.cliff.type === "LATER_OF") {
    const probedDate = probeLaterOf(vestingPeriod.cliff, overlayCtx);
    if (probedDate) {
      return evaluateUnresolvedCliff(dates, amounts, probedDate, blockers);
    }
  }

  // Unresolved Cliff and no best of LATER_OF selector
  // NOTE: consider throwing an error here.  cliffRes should not return Picked with an unresolved node unless cliff.type is LATER_OF
  return makeStartPlusTranches(
    amounts,
    vestingPeriod.type,
    vestingPeriod.length,
    blockers,
  );
}

function evaluateCliffGeneric<T>(
  dates: OCTDate[],
  amounts: number[],
  cliffDate: OCTDate,
  fn: (x: { date: OCTDate; amount: number }) => T,
): T[] {
  const tranches: T[] = [];
  let aggregate = 0;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const amt = amounts[i];

    const isBefore = lt(date, cliffDate);
    const isAt = eq(date, cliffDate);

    aggregate += amt;

    if (isBefore) continue;
    if (isAt) {
      tranches.push(fn({ date, amount: aggregate }));
      continue;
    }
    tranches.push(fn({ date, amount: amt }));
  }

  return tranches;
}

function evaluateResolvedCliff(
  dates: OCTDate[],
  amounts: number[],
  cliffDate: OCTDate,
): ResolvedTranche[] {
  return evaluateCliffGeneric<ResolvedTranche>(
    dates,
    amounts,
    cliffDate,
    ({ date, amount }) => makeResolvedTranche(date, amount),
  );
}

function evaluateUnresolvedCliff(
  dates: OCTDate[],
  amounts: number[],
  cliffDate: OCTDate,
  blockers: Blocker[],
): UnresolvedTranche[] {
  return evaluateCliffGeneric<UnresolvedTranche>(
    dates,
    amounts,
    cliffDate,
    ({ amount }) => makeBeforeCliffTranche(amount, blockers),
  );
}
