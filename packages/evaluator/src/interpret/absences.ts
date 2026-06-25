// The non-occurrences a closed-world resolution is leaning on, derived from the
// blockers it left behind. Shared by two read-sites: `assemble.ts` (the full
// `evaluate` path, folding the whole resolution's blocker list) and
// `resolveVestingStart.ts` (the narrow `resolve_offset` path, folding a committed
// EARLIER_OF's own disclosures). Both want the same derivation, so it lives here
// once. Module-internal only — not re-exported from the package's public index.

import type { AbsenceAssumption, Blocker } from "@vestlang/types";
import { gt } from "@vestlang/primitives";
import { foldBlocker } from "./blockerTree.js";
import { isVestingStartPlaceholder } from "./vestingNode/vestingBase.js";

// A disclosure collapses across blockers per (event, relation), not per event alone.
// One event can be gated two ways on one grant — `... BEFORE EVENT ipo` in one
// statement and `... AFTER EVENT ipo` in another — and those guard opposite sides of
// the boundary; collapsing them on the id alone would silently drop one direction
// (the #399 bug for the gate-both-ways shape). So the key is the relation too. The
// relation is (direction, inclusive, consequence): a gate and a selector can guard the
// *same* event on the same side (e.g. `… AFTER EVENT ipo` gating one portion while a
// `LATER OF (…, EVENT ipo)` anchors another) and differ only in consequence — keying
// without it would collapse the dead-grant watch and the grid-shift watch into one,
// silently dropping a risk type (the #399 collapse bug, now for consequence). Within a
// group the latest `through` wins — assuming absence over the wider window is the
// stronger, safe claim.
const groupKey = (a: AbsenceAssumption): string =>
  `${a.eventId}|${a.direction}|${a.inclusive ? "1" : "0"}|${a.consequence}`;

/**
 * Closed-world resolution reads "no firing on record" as "hasn't happened" — so
 * reading a schedule as, say, vested can quietly depend on some event still being
 * absent. We surface each such dependency from the given blockers: every "still
 * waiting on event X" blocker that got measured against a known date carries that
 * date and the relation it guards against, and that's exactly what we're assuming
 * about X's absence. A bare wait with no date to compare against isn't a dated
 * assumption, so it's left to the blocker list rather than disclosed here; the
 * vesting-start placeholder isn't a real event and is never disclosed.
 */
export const collectAbsences = (blockers: Blocker[]): AbsenceAssumption[] => {
  const byRelation = new Map<string, AbsenceAssumption>();

  for (const top of blockers) {
    foldBlocker<void>(top, (node) => {
      if (
        node.type !== "EVENT_NOT_YET_OCCURRED" ||
        node.through === undefined ||
        isVestingStartPlaceholder(node)
      )
        return;
      // A dated blocker always carries the full descriptor alongside `through` (they're
      // stamped together in withBoundary), so direction/inclusive are present here.
      // `consequence` has no honest default — unlike direction's "before" belt, neither
      // value is safe to invent — so we assert the invariant rather than lie: a dated
      // blocker without it would be a mint-site bug, and surfacing it as a throw is far
      // better than publishing a wrong dead-grant-vs-shift verdict.
      if (node.consequence === undefined)
        throw new Error(
          `dated absence blocker for "${node.event}" has no consequence`,
        );
      const assumption: AbsenceAssumption = {
        eventId: node.event,
        through: node.through,
        direction: node.direction ?? "before",
        inclusive: node.inclusive ?? false,
        consequence: node.consequence,
      };
      const key = groupKey(assumption);
      const prior = byRelation.get(key);
      if (prior === undefined || gt(assumption.through, prior.through))
        byRelation.set(key, assumption);
    });
  }

  return [...byRelation.values()].sort((x, y) =>
    x.eventId < y.eventId ? -1 : x.eventId > y.eventId ? 1 : 0,
  );
};
