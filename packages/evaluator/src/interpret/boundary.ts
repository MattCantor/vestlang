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
// Two merges, because a blocker can already carry a stamp from a gate nested inside
// this one:
//   - `through` keeps the later of the two dates — assuming absence over the wider
//     window is the conservative watch-list claim.
//   - the descriptor is preserved if already present. A selector re-stamping a
//     blocker an inner constraint already minted must NOT blunt the inner relation
//     down to the selector's coarser one — the inner descriptor is the tighter, more
//     dangerous claim (e.g. an `AFTER` gate buried under a LATER OF). A fresh blocker
//     (the common gate-mint case) has none yet, so it takes the one passed here. This
//     covers `consequence` too: a gate's `flips-to-impossible` survives a LATER OF
//     re-stamp rather than being softened to the selector's `grid-shift`.
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
          return {
            ...node,
            through:
              node.through && gt(node.through, date) ? node.through : date,
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
