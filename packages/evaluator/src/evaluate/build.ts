import {
  Statement,
  PeriodTag,
  OCTDate,
  EvaluationContext,
  EvaluationContextInput,
  Tranche,
  Schedule,
  NodeMeta,
  UnresolvedTranche,
  VestingPeriod,
  VestingNodeExpr,
  UnresolvedNode,
  ImpossibleNode,
  ImpossibleBlocker,
  Blocker,
} from "@vestlang/types";
import { prepare } from "../utils.js";
import { allocateQuantity } from "./allocation.js";
import { evaluateVestingNodeExpr, evaluateScheduleExpr } from "./selectors.js";
import { nextDate } from "./time.js";
import { accumulateUntilPivot } from "./cliff.js";

/* ------------------------
 * Helpers
 * ------------------------ */

function makeImpossibleTranches(
  n: number,
  blockers: ImpossibleBlocker[],
): Tranche[] {
  return Array.from({ length: n }, () => ({
    amount: 0,
    meta: { state: "IMPOSSIBLE", blockers },
  }));
}

function makeStartPlusTranches(
  amounts: number[],
  unit: PeriodTag,
  steplength: number,
  blockers: Blocker[],
): UnresolvedTranche[] {
  return Array.from({ length: amounts.length }, (_, i) => ({
    amount: amounts[i],
    meta: {
      state: "UNRESOLVED",
      date: {
        type: "START_PLUS",
        unit,
        steps: i * steplength,
      },
      blockers,
    },
  }));
}

function makeResolvedTranches(dates: OCTDate[], amounts: number[]): Tranche[] {
  const tranches: Tranche[] = [];
  dates.forEach((date, i) =>
    tranches.push({
      amount: amounts[i],
      date,
      meta: { state: "RESOLVED" },
    }),
  );
  return tranches;
}

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
  const expr = stmt.expr;

  let tranches: Tranche[] = [];
  let selectedSchedule: Schedule | undefined = undefined;
  let startRes: NodeMeta | undefined = undefined;

  // Choose schedule by resolved vesting_start if selector
  const selection = evaluateScheduleExpr(expr, ctx);

  switch (selection.type) {
    case "IMPOSSIBLE":
      makeImpossibleTranches(1, selection.blockers);

    case "UNRESOLVED":
      return [
        {
          amount: ctx.grantQuantity,
          meta: {
            state: "UNRESOLVED",
            date: { type: "BEFORE_VESTING_START" },
            blockers: selection.blockers,
          },
        },
      ];
    case "PICKED":
      selectedSchedule = selection.picked;

      // Determine number of installments
      const installmentCount = Math.max(
        selectedSchedule.periodicity.occurrences,
        0,
      );

      // Return [] if there are no installments
      if (installmentCount === 0) {
        return [];
      }

      // Create an array of the installment amounts from the quantity applicable to this statement
      const installmentAmounts = allocateQuantity(
        statementQuantity,
        installmentCount,
        ctx.allocation_type,
      );

      switch (selection.meta.type) {
        case "UNRESOLVED":
          startRes = selection.meta;
          tranches = buildUnresolvedStart(
            startRes,
            selectedSchedule,
            installmentAmounts,
          );
          break;
        case "RESOLVED":
          startRes = selection.meta;
          tranches = buildResolvedStart(
            startRes,
            selectedSchedule,
            installmentAmounts,
            ctx,
          );
          break;
      }
  }

  return aggregateDuplicateTranches(tranches);
}

function buildUnresolvedStart(
  startRes: UnresolvedNode | ImpossibleNode,
  selectedSchedule: Schedule,
  installmentAmounts: number[],
): Tranche[] {
  if (startRes.type === "IMPOSSIBLE") {
    return makeImpossibleTranches(installmentAmounts.length, startRes.blockers);
  }

  return makeStartPlusTranches(
    installmentAmounts,
    selectedSchedule.periodicity.type,
    selectedSchedule.periodicity.length,
    startRes.blockers,
  );
}

function buildResolvedStart(
  startRes: Extract<NodeMeta, { type: "RESOLVED" }>,
  selectedSchedule: Schedule,
  installmentAmounts: number[],
  ctx: EvaluationContext,
): Tranche[] {
  let dates = generateCadence(selectedSchedule.periodicity, startRes.date, ctx);
  const vestingPeriod = selectedSchedule.periodicity;

  if (vestingPeriod.cliff) {
    const overlayCtx: EvaluationContext = {
      ...ctx,
      events: { ...ctx.events, vestingStart: startRes.date },
    };

    const resVestingPeriod = vestingPeriod as VestingPeriod & {
      cliff: VestingNodeExpr;
    };

    // Choose cliff
    const selection = evaluateVestingNodeExpr(vestingPeriod.cliff, overlayCtx);

    if (selection.type === "IMPOSSIBLE")
      return makeImpossibleTranches(dates.length, selection.blockers);

    if (selection.type === "PICKED" && selection.meta.type === "RESOLVED")
      return accumulateUntilPivot(dates, installmentAmounts, {
        type: "RESOLVED",
        pivotDate: selection.meta.date,
      });

    if (selection.type === "PICKED" && selection.meta.type === "UNRESOLVED")
      return accumulateUntilPivot(dates, installmentAmounts, {
        type: "UNRESOLVED",
        nodeMeta: selection.meta,
        vestingPeriod: resVestingPeriod,
        ctx: overlayCtx,
      });

    return accumulateUntilPivot(dates, installmentAmounts, {
      type: "UNRESOLVED",
      nodeMeta: selection as UnresolvedNode,
      vestingPeriod: resVestingPeriod,
      ctx: overlayCtx,
    });
  }
  return makeResolvedTranches(dates, installmentAmounts);
}

function aggregateDuplicateTranches(tranches: Tranche[]) {
  const aggregated: Tranche[] = tranches.reduce((acc, current) => {
    const prev = acc[acc.length - 1];

    if (
      prev &&
      prev.meta.state === "RESOLVED" &&
      current.meta.state === "RESOLVED" &&
      prev.date === current.date
    ) {
      // Merge into previous item
      prev.amount += current.amount;
    } else {
      acc.push({ ...current });
    }

    return acc;
  }, [] as Tranche[]);

  return aggregated;
}

function generateCadence(
  vestingPeriod: VestingPeriod,
  vestingStartDate: OCTDate,
  ctx: EvaluationContext,
): OCTDate[] {
  let dates: OCTDate[] = [];
  const { type, length, occurrences } = vestingPeriod;
  let d = vestingStartDate;
  for (let i = 0; i < occurrences; i++) {
    d = nextDate(d, type, length, ctx);
    dates.push(d);
  }
  return dates;
}

// function buildResolvedCliff(
//   nodeMeta: ResolvedNode,
//   dates: OCTDate[],
//   installmentAmounts: number[],
// ) {
//   const cliffDate = nodeMeta.date;
//   dates = catchUp(dates, cliffDate);
//
//   const result = dates.reduce((acc, date, i) => {
//     let accumulatedAmount = 0;
//     if (lt(date, cliffDate)) accumulatedAmount += installmentAmounts[i];
//     if (eq(date, cliffDate)) {
//       accumulatedAmount += installmentAmounts[i];
//       acc.push({
//         amount: accumulatedAmount,
//         date,
//         meta: {
//           state: "RESOLVED",
//         },
//       });
//     } else {
//       acc.push({
//         amount: installmentAmounts[i],
//         date,
//         meta: {
//           state: "RESOLVED",
//         },
//       });
//     }
//
//     return acc;
//   }, [] as Tranche[]);
//   return result;
// }

// function buildUnresolvedCliff(
//   nodeMeta: UnresolvedNode,
//   dates: OCTDate[],
//   installmentAmounts: number[],
//   vestingPeriod: VestingPeriod & {
//     cliff: VestingNodeExpr;
//   },
//   ctx: EvaluationContext,
// ): Tranche[] {
//   const { type, length, cliff } = vestingPeriod;
//   const blockers = nodeMeta.blockers;
//
//   if (cliff.type === "LATER_OF") {
//     const floor = probeLaterOf(cliff, ctx);
//     if (floor) {
//       dates = catchUp(dates, floor);
//       let accumulatedAmount = 0;
//       const result = dates.reduce((acc, date, i) => {
//         let amount = 0;
//         if (lt(date, floor) || eq(date, floor)) {
//           accumulatedAmount += installmentAmounts[i];
//         } else {
//           amount = installmentAmounts[i];
//         }
//
//         acc.push({
//           amount,
//           meta: {
//             state: "UNRESOLVED",
//             date: symPlus(type, i * length),
//             blockers,
//           },
//         } as UnresolvedTranche);
//         return acc;
//       }, [] as Tranche[]);
//       return result;
//     }
//   }
//   return dates.map((_, i) => ({
//     amount: installmentAmounts[i],
//     meta: {
//       state: "UNRESOLVED",
//       date: { type: "MAYBE_BEFORE_CLIFF" },
//       blockers,
//     },
//   }));
// }
