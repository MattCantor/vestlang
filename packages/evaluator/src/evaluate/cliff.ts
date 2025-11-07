import type {
  Blocker,
  EvaluationContext,
  ImpossibleInstallment,
  OCTDate,
  ResolvedInstallment,
  UnresolvedInstallment,
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
  makeUnresolvedCliffSchedule,
  makeImpossibleSchedule,
  makeResolvedInstallment,
  makeStartPlusSchedule,
  makeUnresolvedCliffInstallment,
} from "./makeTranches.js";
import { EvaluatedSchedule } from "../../../types/dist/evaluation.js";

export function evaluateCliff(
  resSchedule: PickedResolved<ScheduleWithCliff>,
  dates: OCTDate[],
  amounts: number[],
  ctx: EvaluationContext,
):
  | EvaluatedSchedule<ImpossibleInstallment>
  | EvaluatedSchedule<ResolvedInstallment>
  | EvaluatedSchedule<UnresolvedInstallment> {
  // Prepare ctx and check if the cliff is resolved
  const overlayCtx: EvaluationContext = {
    ...ctx,
    events: { ...ctx.events, vestingStart: resSchedule.meta.date },
  };

  const vestingPeriod = resSchedule.picked.periodicity;
  const resCliff = evaluateVestingNodeExpr(vestingPeriod.cliff, overlayCtx);

  // impossible cliff
  if (resCliff.type === "IMPOSSIBLE")
    return makeImpossibleSchedule(amounts, resCliff.blockers);

  // unresolved cliff and no best of LATER_OF selector
  if (resCliff.type === "UNRESOLVED")
    return makeUnresolvedCliffSchedule(dates, amounts, resCliff.blockers);

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
  return makeStartPlusSchedule(
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
  const installments: T[] = [];
  let aggregate = 0;
  let cliffResolved = false;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const amt = amounts[i];

    const isBefore = lt(date, cliffDate);
    const isAt = eq(date, cliffDate);

    // only aggregate for dates before the cliff
    if (isBefore) {
      aggregate += amt;
      continue;
    }

    // aggregate and create cliff installment when date === cliffDate
    if (isAt) {
      aggregate += amt;
      installments.push(fn({ date, amount: aggregate }));
      cliffResolved = true;
      continue;
    }

    // If the cliff has not yet been resolved, create a cliff installment if the cliff date precedes the next date
    // cliffDate may be the grantDate.  Don't create an installment if aggregate === 0
    if (!cliffResolved && lt(cliffDate, date) && aggregate > 0) {
      installments.push(fn({ date: cliffDate, amount: aggregate }));
      cliffResolved = true;
    }
    installments.push(fn({ date, amount: amt }));
  }

  return installments;
}

export function evaluateGrantDate(
  dates: OCTDate[],
  amounts: number[],
  cliffDate: OCTDate,
): { newDates: OCTDate[]; newAmounts: number[] } {
  const vestings = evaluateCliffGeneric<{ date: OCTDate; amount: number }>(
    dates,
    amounts,
    cliffDate,
    ({ date, amount }) => ({ date, amount }),
  );

  let newDates: OCTDate[] = [];
  let newAmounts: number[] = [];

  for (const v of vestings) {
    newDates.push(v.date);
    newAmounts.push(v.amount);
  }

  return { newDates, newAmounts };
}

function evaluateResolvedCliff(
  dates: OCTDate[],
  amounts: number[],
  cliffDate: OCTDate,
): EvaluatedSchedule<ResolvedInstallment> {
  const installments = evaluateCliffGeneric<ResolvedInstallment>(
    dates,
    amounts,
    cliffDate,
    ({ date, amount }) => makeResolvedInstallment(date, amount),
  );

  return { installments, blockers: [] };
}

function evaluateUnresolvedCliff(
  dates: OCTDate[],
  amounts: number[],
  cliffDate: OCTDate,
  blockers: Blocker[],
): EvaluatedSchedule<UnresolvedInstallment> {
  const installments = evaluateCliffGeneric<UnresolvedInstallment>(
    dates,
    amounts,
    cliffDate,
    ({ date, amount }) =>
      makeUnresolvedCliffInstallment(date, amount, blockers),
  );

  return { installments, blockers };
}
