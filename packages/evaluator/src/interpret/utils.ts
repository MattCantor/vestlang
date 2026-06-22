import type {
  CommittedNode,
  ImpossibleNode,
  OCTDate,
  ResolvedNode,
  UnresolvedNode,
} from "@vestlang/types";

// A Picked result carries the chosen item plus its resolution meta. It splits
// three ways on `meta.type` (all arms stay `type: "PICKED"`):
//   - resolved:  the pick has fully settled to a date.
//   - partial:   a partially-resolved LATER_OF — `picked` is the latest of the
//     arms settled so far, still waiting on the rest. `pivot` is that latest
//     settled arm's date: a lower bound the pending arms can only push later,
//     never earlier. Required on this arm so any construction site that omits it
//     fails the build — the partial pick can't exist without knowing its floor.
//   - committed: an EARLIER_OF that settled to its resolved floor in `resolution`
//     mode (see CommittedNode). It has a date like RESOLVED, but its meta also
//     carries the still-pending siblings' disclosures, so it's a distinct arm
//     rather than RESOLVED-with-an-extra-field — a date-read site that handles
//     only RESOLVED won't silently drop them.
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

export interface PickedCommitted<T> extends PickedBase<T> {
  meta: CommittedNode;
}

type Picked<T> = PickedResolved<T> | PickedPartial<T> | PickedCommitted<T>;

export type PickReturn<T> = Picked<T> | UnresolvedNode | ImpossibleNode;

export function isPickedResolved<T>(x: PickReturn<T>): x is PickedResolved<T> {
  return x.type === "PICKED" && x.meta.type === "RESOLVED";
}

export function isPickedPartial<T>(x: PickReturn<T>): x is PickedPartial<T> {
  return x.type === "PICKED" && x.meta.type === "UNRESOLVED";
}

export function isPickedCommitted<T>(
  x: PickReturn<T>,
): x is PickedCommitted<T> {
  return x.type === "PICKED" && x.meta.type === "COMMITTED";
}

// The one accessor every date-extracting read-site uses. A RESOLVED and a
// COMMITTED pick both carry a concrete date (the latter being the committed
// floor), so both return it; everything else returns undefined. Routing all
// date reads through here is what makes a forgotten COMMITTED case a build break
// (the read silently undefined) rather than a silent fall-through to "not
// resolved".
export function pickedDate<T>(x: PickReturn<T>): OCTDate | undefined {
  if (x.type !== "PICKED") return undefined;
  if (x.meta.type === "RESOLVED" || x.meta.type === "COMMITTED")
    return x.meta.date;
  return undefined;
}
