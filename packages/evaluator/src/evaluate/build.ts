import type {
  Statement,
  OCTDate,
  EvaluationContext,
  EvaluationContextInput,
  Tranche,
  Schedule,
} from "@vestlang/types";
import { prepare } from "../utils.js";
import { allocateQuantity } from "./allocation.js";
import { evaluateScheduleExpr } from "./selectors.js";
import { nextDate } from "./time.js";
import { evaluateCliff } from "./cliff.js";
import type { Picked, PickedResolved, ScheduleWithCliff } from "./utils.js";
import {
  makeBeforeVestingStartTranche,
  makeImpossibleTranches,
  makeResolvedTranches,
  makeStartPlusTranches,
} from "./makeTranches.js";

/* ------------------------
 * Helpers
 * ------------------------ */

/**
 * Produce a list of tranches with symbolic dates and blockers
 * Inputs: a normalized `Statement` and an `EvaluationContextInput`.
 * returns: `Tranche[]`
 */
export function evaluateStatement(
  stmt: Statement,
  ctx_input: EvaluationContextInput,
): Tranche[] {
  const { ctx, statementQuantity } = prepare(stmt, ctx_input);
  const resSchedule = evaluateScheduleExpr(stmt.expr, ctx);

  switch (resSchedule.type) {
    case "IMPOSSIBLE":
      return makeImpossibleTranches(1, resSchedule.blockers);

    case "UNRESOLVED":
      return [
        makeBeforeVestingStartTranche(ctx.grantQuantity, resSchedule.blockers),
      ];
    case "PICKED":
      return evaluateSchedule(resSchedule, statementQuantity, ctx);
  }
}

function evaluateSchedule(
  resSchedule: Picked<Schedule>,
  statementQuantity: number,
  ctx: EvaluationContext,
): Tranche[] {
  const pickedSchedule = resSchedule.picked;
  const vestingPeriod = pickedSchedule.periodicity;
  const { type, length, occurrences } = vestingPeriod;

  // Return [] if there are no installments
  if (occurrences < 1) {
    return [];
  }

  // Create an array of the installment amounts from the quantity applicable to this statement
  const installmentAmounts = allocateQuantity(
    statementQuantity,
    occurrences,
    ctx.allocation_type,
  );

  // Unrsolved start
  if (resSchedule.meta.type === "UNRESOLVED")
    return makeStartPlusTranches(
      installmentAmounts,
      type,
      length,
      resSchedule.meta.blockers,
    );

  // Resolved start

  // Generate vesting dates
  let d = resSchedule.meta.date;
  const dates: OCTDate[] = [];
  for (let i = 0; i < occurrences; i++) {
    d = nextDate(d, type, length, ctx);
    dates.push(d);
  }

  // No cliff
  if (!vestingPeriod.cliff)
    return makeResolvedTranches(dates, installmentAmounts);

  // With cliff
  return evaluateCliff(
    resSchedule as PickedResolved<ScheduleWithCliff>,
    dates,
    installmentAmounts,
    ctx,
  );
}
