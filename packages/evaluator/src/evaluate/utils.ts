import {
  EvaluationContext,
  LaterOfVestingNode,
  OCTDate,
} from "@vestlang/types";
import { lt } from "./time.js";
import { evaluateVestingNodeExpr } from "./selectors.js";

// /**
//  * Catch-up: collapse all installments strictly before `floor` into one tranche on `floor`.
//  */
// export function catchUp(dates: readonly OCTDate[], floor: OCTDate): OCTDate[] {
//   let idx = 0;
//   while (idx < dates.length && lt(dates[idx], floor)) idx++;
//
//   if (idx > 0) {
//     // Replace all earlier installments with a single tranche at `floor`
//     return [floor, ...dates.slice(idx)];
//   }
//   return [...dates];
// }

/** Probe for latest resolved dates within a LATER OF */
export function probeLaterOf(
  expr: LaterOfVestingNode,
  ctx: EvaluationContext,
): OCTDate | undefined {
  const resolvedDates: OCTDate[] = [];

  for (const item of expr.items) {
    const res = evaluateVestingNodeExpr(item, ctx);
    if (res.type === "PICKED" && res.meta.type === "RESOLVED")
      resolvedDates.push(res.meta.date);
    continue;
  }

  if (resolvedDates.length === 0) return undefined;

  // latest of all resolved so far
  let latest = resolvedDates[0];
  for (let i = 1; i < resolvedDates.length; i++) {
    if (lt(latest, resolvedDates[i])) latest = resolvedDates[i];
  }

  return latest;
}
