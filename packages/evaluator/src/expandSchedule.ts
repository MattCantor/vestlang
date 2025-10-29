// import {
//   OCTDate,
//   Schedule as NormalizedSchedule,
//   VestingNodeExpr,
//   ResolvedNode,
//   NodeMeta,
// } from "@vestlang/types";
// import { resolveNodeExpr } from "./resolve.js";
// import {
//   AllocatedSchedule,
//   EvaluationContext,
//   ExpandedSchedule,
//   NodeResolutionState,
// } from "./types.js";
// import { lt, nextDate } from "./time.js";
// import { allocateQuantity } from "./allocation.js";
// import { evaluateVestingNodeExpr } from "./selectors.js";
//
// function expandSchedule(
//   selectedSchedule: NormalizedSchedule,
//   startRes: ResolvedNode,
//   ctx: EvaluationContext,
// ): ExpandedSchedule {
//   // if (startRes.state !== "resolved") {
//   //   return { vesting_start: startRes, tranches: [] };
//   // }
//
//   // Generate cadence (first installment at start + 1 period)
//   let dates: OCTDate[] = [];
//   let d = startRes.date;
//   const { type, length, occurrences } = selectedSchedule.periodicity;
//   for (let i = 0; i < occurrences; i++) {
//     d = nextDate(d, type, length, ctx);
//     dates.push(d);
//   }
//
//   // Resolve cliff using overlay ctx
//   let cliffRes: NodeMeta;
//
//   if (selectedSchedule.periodicity.cliff) {
//     const overlayCtx: EvaluationContext = {
//       ...ctx,
//       events: { ...ctx.events, vestingStart: startRes.date },
//     };
//     // cliffRes = resolveNodeExpr(selectedSchedule.periodicity.cliff, overlayCtx);
//     cliffRes = evaluateVestingNodeExpr(
//       selectedSchedule.periodicity.cliff,
//       overlayCtx,
//     );
//     if (cliffRes.type === "RESOLVED") {
//       dates = catchUp(dates, cliffRes.date);
//     } else if (
//       selectedSchedule.periodicity.cliff &&
//       selectedSchedule.periodicity.cliff.type === "LATER_OF"
//     ) {
//       const floor = probeLaterOf(
//         selectedSchedule.periodicity.cliff,
//         overlayCtx,
//       );
//       if (floor) {
//         dates = catchUp(dates, floor);
//       }
//     }
//   }
//
//   return {
//     vesting_start: startRes,
//     cliff: cliffRes,
//     tranches: dates.map((date) => ({ date })),
//   };
// }
//
// /** Probe for latest resolved dates within a LATER OF */
// function probeLaterOf(
//   expr: Extract<VestingNodeExpr, { type: "LATER_OF" }>,
//   ctx: EvaluationContext,
// ): OCTDate | undefined {
//   const resolvedDates: OCTDate[] = [];
//
//   for (const item of expr.items) {
//     const resolved: NodeResolutionState = resolveNodeExpr(item, ctx);
//     if (resolved.state === "inactive") {
//       return undefined;
//     }
//     if (resolved.state === "resolved") {
//       resolvedDates.push(resolved.date);
//     }
//     // unresolved: ignore for this probe
//   }
//
//   if (resolvedDates.length === 0) return undefined;
//
//   // latest of all resolved so far
//   let latest = resolvedDates[0];
//   for (let i = 1; i < resolvedDates.length; i++) {
//     if (lt(latest, resolvedDates[i])) latest = resolvedDates[i];
//   }
//
//   return latest;
// }
//
// /**
//  * Catch-up: collapse all installments strictly before `floor` into one tranche on `floor`.
//  */
// function catchUp(dates: readonly OCTDate[], floor: OCTDate): OCTDate[] {
//   let idx = 0;
//   while (idx < dates.length && lt(dates[idx], floor)) idx++;
//
//   if (idx > 0) {
//     // Replace all earlier installments with a single tranche at `floor`
//     return [floor, ...dates.slice(idx)];
//   }
//   return [...dates];
// }
//
// /** Expand a ScheduleExpr and allocate integer shares accross its tranches.
//  * Returns tranches with concrete amount and an 'unresolved' remainder (should be 0).
//  */
// export function expandAllocatedSchedule(
//   startRes: ResolvedNode,
//   selectedSchedule: NormalizedSchedule,
//   statementQuantity: number,
//   ctx: EvaluationContext,
// ): AllocatedSchedule {
//   const expanded = expandSchedule(selectedSchedule, startRes, ctx);
//
//   if (
//     expanded.vesting_start.state !== "resolved" ||
//     expanded.tranches.length === 0
//   ) {
//     return {
//       vesting_start: expanded.vesting_start,
//       cliff: expanded.cliff,
//       tranches: [],
//       unresolved: statementQuantity,
//     };
//   }
//
//   const n = expanded.tranches.length;
//   const splits = allocateQuantity(statementQuantity, n, ctx.allocation_type);
//   const scheduled = splits.reduce((a, b) => a + b, 0);
//   const remainder = statementQuantity - scheduled;
//
//   return {
//     vesting_start: expanded.vesting_start,
//     cliff: expanded.cliff,
//     tranches: expanded.tranches.map((tranche, i) => ({
//       date: tranche.date,
//       amount: splits[i],
//     })),
//     unresolved: remainder < 0 ? 0 : remainder,
//   };
// }
