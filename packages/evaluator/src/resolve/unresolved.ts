// The unresolved producer — symbolic installments + blockers for a statement
// that can't materialize yet. Relocated out of the deleted legacy engine; it
// reuses only shared resolution infrastructure (the selector layer) plus core's
// date math / allocator and the retained makeTranches factories. It reproduces
// the legacy non-resolved branches; the fully-resolved path is core.compile's
// job (the unresolved arm discards any RESOLVED installments anyway).

import type {
  Blocker,
  EvaluationContext,
  InstallmentSet,
  LaterOfVestingNode,
  OCTDate,
  Statement,
  VestingNode,
} from "@vestlang/types";
import { addPeriod, allocateVector, foldToGrantDate } from "@vestlang/core";
import { amountToQuantify } from "../utils.js";
import {
  evaluateScheduleExpr,
  evaluateVestingNodeExpr,
} from "../evaluate/selectors.js";
import {
  isPickedResolved,
  probeLaterOf,
  type PickedUnresolved,
} from "../evaluate/utils.js";
import {
  makeImpossibleSchedule,
  makeStartPlusSchedule,
  makeUnresolvedCliffInstallment,
  makeUnresolvedCliffSchedule,
  makeUnresolvedVestingStartSchedule,
} from "../evaluate/makeTranches.js";

const EMPTY: InstallmentSet = { installments: [], blockers: [] };

/**
 * Symbolic installments + blockers for one statement. A fully-resolved statement
 * yields no installments (EMPTY) — it isn't part of the unresolved verdict.
 */
export const unresolvedInstallments = (
  stmt: Statement,
  ctx: EvaluationContext,
): InstallmentSet => {
  const statementQuantity = amountToQuantify(stmt.amount, ctx.grantQuantity);
  const res = evaluateScheduleExpr(stmt.expr, ctx);

  if (res.type === "IMPOSSIBLE")
    return makeImpossibleSchedule([statementQuantity], res.blockers);
  if (res.type === "UNRESOLVED")
    return makeUnresolvedVestingStartSchedule(
      [statementQuantity],
      res.blockers,
    );

  // PICKED
  const { type, length, occurrences } = res.picked.periodicity;
  const amounts = allocateVector(
    statementQuantity,
    occurrences,
    ctx.allocation_type,
  );

  // Unresolved vesting start (a LATER_OF whose winner didn't resolve).
  if (res.meta.type === "UNRESOLVED")
    return makeStartPlusSchedule(amounts, type, length, res.meta.blockers);

  // Resolved start — generate the grid (anchored from start to avoid drift),
  // fold the grant-date lump, then inspect the cliff.
  const start = res.meta.date;
  let dates: OCTDate[] = Array.from(
    { length: occurrences },
    (_, i) =>
      addPeriod(
        start,
        length * (i + 1),
        type,
        ctx.vesting_day_of_month,
      ) as OCTDate,
  );
  if (ctx.events.grantDate) {
    const folded = foldToGrantDate(dates, amounts, ctx.events.grantDate);
    dates = folded.dates as OCTDate[];
    amounts.length = 0;
    amounts.push(...folded.amounts);
  }

  const cliff = res.picked.periodicity.cliff;
  if (!cliff) return EMPTY; // fully resolved → not part of the unresolved verdict

  const overlayCtx: EvaluationContext = {
    ...ctx,
    events: { ...ctx.events, vestingStart: start },
  };
  const resCliff = evaluateVestingNodeExpr(cliff, overlayCtx);

  if (resCliff.type === "IMPOSSIBLE")
    return makeImpossibleSchedule(amounts, resCliff.blockers);
  if (resCliff.type === "UNRESOLVED")
    return makeUnresolvedCliffSchedule(dates, amounts, resCliff.blockers);
  if (isPickedResolved(resCliff)) return EMPTY; // resolved cliff → fully resolved

  // PICKED with an unresolved node: a LATER_OF whose best branch resolved.
  const blockers: Blocker[] = (resCliff as PickedUnresolved<VestingNode>).meta
    .blockers;
  if (cliff.type === "LATER_OF") {
    const probed = probeLaterOf(cliff as LaterOfVestingNode, overlayCtx);
    if (probed) {
      const folded = foldToGrantDate(dates, amounts, probed);
      return {
        installments: folded.dates.map((d, i) =>
          makeUnresolvedCliffInstallment(
            d as OCTDate,
            folded.amounts[i],
            blockers,
          ),
        ),
        blockers,
      };
    }
  }
  return makeStartPlusSchedule(amounts, type, length, blockers);
};
