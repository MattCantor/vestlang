import type {
  ImpossibleNode,
  OCTDate,
  ResolvedNode,
  UnresolvedNode,
} from "@vestlang/types";

// A Picked result carries the chosen item plus its resolution meta. It splits in
// two on `meta.type` (both arms stay `type: "PICKED"`):
//   - resolved: the pick has fully settled to a date.
//   - partial: a partially-resolved LATER_OF — `picked` is the latest of the arms
//     settled so far, still waiting on the rest. `pivot` is that latest settled
//     arm's date: a lower bound the pending arms can only push later, never earlier.
//     It's required on this arm so any construction site that omits it fails the
//     build — the partial pick can't exist without knowing the floor it sits on.
interface PickedBase<T> {
  type: "PICKED";
  picked: T;
}

export interface PickedResolved<T> extends PickedBase<T> {
  meta: ResolvedNode;
}

export interface PickedPartial<T> extends PickedBase<T> {
  meta: UnresolvedNode;
  pivot: OCTDate;
}

type Picked<T> = PickedResolved<T> | PickedPartial<T>;

export type PickReturn<T> = Picked<T> | UnresolvedNode | ImpossibleNode;

export function isPickedResolved<T>(x: PickReturn<T>): x is PickedResolved<T> {
  return x.type === "PICKED" && x.meta.type === "RESOLVED";
}

export function isPickedPartial<T>(x: PickReturn<T>): x is PickedPartial<T> {
  return x.type === "PICKED" && x.meta.type === "UNRESOLVED";
}
