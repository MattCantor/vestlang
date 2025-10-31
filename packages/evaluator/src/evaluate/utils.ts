import type {
  EvaluationContext,
  ImpossibleNode,
  LaterOfVestingNode,
  OCTDate,
  ResolvedNode,
  Schedule,
  UnresolvedNode,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";
import { lt } from "./time.js";
import { evaluateVestingNodeExpr } from "./selectors.js";

// Picked with UnresolvedNode indicates an unresolved LaterOf selector, where picked represents the latest of the resolved items
export interface Picked<T> {
  type: "PICKED";
  picked: T;
  meta: ResolvedNode | UnresolvedNode;
}

export interface PickedResolved<T> extends Picked<T> {
  meta: ResolvedNode;
}

export interface PickedUnresolved<T> extends Picked<T> {
  meta: UnresolvedNode;
}

export type VestingPeriodWithCliff = VestingPeriod & { cliff: VestingNodeExpr };

export type ScheduleWithCliff = Schedule & {
  periodicity: VestingPeriodWithCliff;
};

// export type PickResolvedScheduleWithCliff = PickedResolved<Schedule> & {
//   picked: { periodicity: { cliff: VestingNodeExpr } };
// };

export type PickReturn<T> = Picked<T> | UnresolvedNode | ImpossibleNode;

export function isPickedResolved<T>(x: any): x is PickedResolved<T> {
  return (
    !!x &&
    typeof x === "object" &&
    x.type === "PICKED" &&
    x.meta.type === "RESOLVED"
  );
}
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
