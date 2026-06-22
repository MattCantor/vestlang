import type { Blocker, OCTDate } from "@vestlang/types";
import { assertNever } from "@vestlang/utils";
import { gt } from "@vestlang/primitives";
import { foldBlocker } from "./blockerTree.js";

// When a pending event is checked against a known date — a gate's "before/after
// <date>", or the date a LATER OF has already settled on — record that date on the
// "still waiting on event X" blockers underneath. It's the date we're taking the
// event to still be absent on/before, which is what the absence-assumption
// disclosure reports. If a blocker already carries an earlier date (from a gate
// nested inside this one), we keep the later of the two: assuming absence over the
// wider window is the conservative choice. The fold descends selector arms so an
// event buried in one still gets stamped; impossible arms hold no pending events,
// so they're returned untouched (which also keeps their narrower blocker type).
export const withBoundary = (blockers: Blocker[], date: OCTDate): Blocker[] =>
  blockers.map((b) =>
    foldBlocker<Blocker>(b, (node, children) => {
      switch (node.type) {
        case "EVENT_NOT_YET_OCCURRED":
          return {
            ...node,
            through:
              node.through && gt(node.through, date) ? node.through : date,
          };
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
