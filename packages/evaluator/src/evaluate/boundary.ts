import type { Blocker, OCTDate } from "@vestlang/types";
import { gt } from "./time.js";

// When a pending event is checked against a known date — a gate's "before/after
// <date>", or the date a LATER OF has already settled on — record that date on the
// "still waiting on event X" blockers underneath. It's the date we're taking the
// event to still be absent on/before, which is what the absence-assumption
// disclosure reports. If a blocker already carries an earlier date (from a gate
// nested inside this one), we keep the later of the two: assuming absence over the
// wider window is the conservative choice. Blockers other than a pending event pass
// through unchanged, and we descend a selector's arms so an event buried in one
// still gets stamped.
export const withBoundary = (blockers: Blocker[], date: OCTDate): Blocker[] =>
  blockers.map((b) => {
    switch (b.type) {
      case "EVENT_NOT_YET_OCCURRED":
        return {
          ...b,
          through: b.through && gt(b.through, date) ? b.through : date,
        };
      case "UNRESOLVED_SELECTOR":
        return { ...b, blockers: withBoundary(b.blockers, date) };
      default:
        return b;
    }
  });
