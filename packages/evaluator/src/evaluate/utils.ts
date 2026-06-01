import type {
  EvaluationContext,
  ImpossibleNode,
  LaterOfVestingNode,
  OCTDate,
  ResolvedNode,
  UnresolvedNode,
} from "@vestlang/types";
import { lt } from "./time.js";
import { evaluateVestingNodeExpr } from "./selectors.js";

// A Picked result carries the chosen item plus its resolution meta. When meta is
// an UnresolvedNode, the pick is a partially-resolved LATER_OF: `picked` is the
// latest of the items resolved so far, still pending the rest.
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

export type PickReturn<T> = Picked<T> | UnresolvedNode | ImpossibleNode;

export function isPickedResolved<T>(x: PickReturn<T>): x is PickedResolved<T> {
  return x.type === "PICKED" && x.meta.type === "RESOLVED";
}

/** Probe for the latest resolved date within a LATER OF (ignoring pending items). */
export function probeLaterOf(
  expr: LaterOfVestingNode,
  ctx: EvaluationContext,
): OCTDate | undefined {
  const resolvedDates: OCTDate[] = [];

  for (const item of expr.items) {
    const res = evaluateVestingNodeExpr(item, ctx);
    if (res.type === "PICKED" && res.meta.type === "RESOLVED")
      resolvedDates.push(res.meta.date);
  }

  if (resolvedDates.length === 0) return undefined;

  let latest = resolvedDates[0];
  for (let i = 1; i < resolvedDates.length; i++) {
    if (lt(latest, resolvedDates[i])) latest = resolvedDates[i];
  }

  return latest;
}
