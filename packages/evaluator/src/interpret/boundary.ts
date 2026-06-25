import type { AbsenceDescriptor, Blocker, OCTDate } from "@vestlang/types";
import { assertNever } from "@vestlang/utils";
import { gt } from "@vestlang/primitives";
import { foldBlocker } from "./blockerTree.js";

// When a pending event is checked against a known date — a gate's boundary, or the
// date a LATER OF has already settled on — record that boundary on the "still
// waiting on event X" blockers underneath, alongside the relation it guards against
// (`direction` + `inclusive`, see AbsenceDescriptor). That's what the schedule's
// absence-assumption disclosure reports.
//
// A blocker can already carry a stamp from a gate nested inside this one, so the
// merge turns on `hasInner` (does it already have a descriptor?):
//   - a fresh blocker — the common gate-mint case — takes the date passed here as its
//     `through` (later-of with whatever it had, though it had none), plus the
//     descriptor passed here.
//   - an already-stamped blocker keeps its inner descriptor (direction / inclusive /
//     consequence). A selector re-stamping a gate an inner constraint already minted
//     must NOT blunt the inner relation down to the selector's coarser one: the inner
//     gate's claim is the tighter, more dangerous one (e.g. an `AFTER` gate buried
//     under a LATER OF). A gate's `flips-to-impossible` survives a re-stamp rather
//     than softening to the selector's `grid-shift`.
//
// `through` is merged by `consequence`, not by `hasInner` alone, because the danger
// boundary lives in different places for the two inner kinds:
//   - an inner *gate* (`flips-to-impossible`) dies the instant the gated event lands
//     on the wrong side of *its own* date, no matter where the outer selector floor
//     sits. So that inner date is the real watch boundary — keep it, don't widen it
//     out to the selector's (later) floor.
//   - an inner *selector* commit (`grid-shift`, e.g. a committed EARLIER_OF folded
//     into an outer LATER_OF) only ever shifts the grid, and #363 discloses it through
//     the *outer* fold's date — the window in which a firing could still move the
//     final answer. So it keeps the later-of merge.
// A fresh blocker has no inner stamp, so it also takes the later-of merge.
//
// The fold descends selector arms so an event buried in one still gets stamped;
// impossible arms hold no pending events, so they're returned untouched (which also
// keeps their narrower blocker type).
export const withBoundary = (
  blockers: Blocker[],
  date: OCTDate,
  descriptor: AbsenceDescriptor,
): Blocker[] =>
  blockers.map((b) =>
    foldBlocker<Blocker>(b, (node, children) => {
      switch (node.type) {
        case "EVENT_NOT_YET_OCCURRED": {
          const hasInner = node.direction !== undefined;
          // An inner gate stamps `through` together with the descriptor, so when its
          // consequence is `flips-to-impossible` the preserved `through` is a real
          // date. Every other case (no inner stamp, or an inner `grid-shift` selector
          // commit) takes the later-of merge — keep `node.through` only when it's
          // already the wider window.
          const keepInnerThrough = node.consequence === "flips-to-impossible";
          return {
            ...node,
            through:
              keepInnerThrough || (node.through && gt(node.through, date))
                ? node.through
                : date,
            direction: hasInner ? node.direction : descriptor.direction,
            inclusive: hasInner ? node.inclusive : descriptor.inclusive,
            consequence: hasInner ? node.consequence : descriptor.consequence,
          };
        }
        case "UNRESOLVED_SELECTOR":
          return { ...node, blockers: children };
        // Nothing to stamp: a condition blocker wraps an AST, not nested pending
        // events, and impossible arms hold no pending events. Left untouched —
        // enumerated rather than defaulted so a new blocker kind has to be
        // classified here instead of silently passing through.
        case "UNRESOLVED_CONDITION":
        case "IMPOSSIBLE_SELECTOR":
        case "IMPOSSIBLE_CONDITION":
          return node;
        default:
          return assertNever(node);
      }
    }),
  );
