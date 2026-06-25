import type { AbsenceDescriptor, Blocker, OCTDate } from "@vestlang/types";
import { assertNever } from "@vestlang/utils";
import { gt } from "@vestlang/primitives";
import { foldBlocker } from "./blockerTree.js";

// When a pending event is checked against a known date — a gate's boundary, or the
// date a LATER OF has already settled on — record that boundary on the "still
// waiting on event X" blockers underneath, alongside the relation it guards against
// (`direction` + `inclusive`, see AbsenceDescriptor). That date + relation travel as
// one `boundary` sub-object, and that's what the schedule's absence-assumption
// disclosure reports.
//
// A blocker can already carry a `boundary` from a gate nested inside this one, so the
// merge keys on whether one is present:
//   - no inner boundary — the common gate-mint case — takes the date passed here as
//     `through` plus the descriptor passed here.
//   - an inner boundary keeps its own descriptor (direction / inclusive /
//     consequence). A selector re-stamping a gate an inner constraint already minted
//     must NOT blunt the inner relation down to the selector's coarser one: the inner
//     gate's claim is the tighter, more dangerous one (e.g. an `AFTER` gate buried
//     under a LATER OF). A gate's `flips-to-impossible` survives a re-stamp rather
//     than softening to the selector's `grid-shift`.
//
// The inner `through` is then selected by its `consequence`, not by inner-presence
// alone, because the danger boundary lives in different places for the two inner kinds:
//   - an inner *gate* (`flips-to-impossible`) dies the instant the gated event lands
//     on the wrong side of *its own* date, no matter where the outer selector floor
//     sits. So that inner date is the real watch boundary — keep it, don't widen it
//     out to the selector's (later) floor.
//   - an inner *selector* commit (`grid-shift`, e.g. a committed EARLIER_OF folded
//     into an outer LATER_OF) only ever shifts the grid, and #363 discloses it through
//     the *outer* fold's date — the window in which a firing could still move the
//     final answer. So it keeps the later-of merge.
// A fresh blocker has no inner boundary, so it takes the passed date directly.
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
          const inner = node.boundary;
          const boundary = inner
            ? {
                ...inner,
                // Only `through` is re-selected; the descriptor rides through from the
                // inner stamp. An inner gate (flips-to-impossible) keeps its OWN date —
                // the watch boundary is where the gate dies, not the outer selector
                // floor. Every other inner (a grid-shift selector commit) takes the
                // later-of merge.
                through:
                  inner.consequence === "flips-to-impossible" ||
                  gt(inner.through, date)
                    ? inner.through
                    : date,
              }
            : { through: date, ...descriptor };
          return { ...node, boundary };
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
