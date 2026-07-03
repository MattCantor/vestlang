// The non-occurrences a closed-world resolves-to reading is leaning on, derived from the
// blockers it left behind. Shared by two read-sites: `assemble.ts` (the full
// `evaluate` path, folding the whole resolves-to blocker list) and
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
 * The resolves-to reading treats "no firing on record" as "hasn't happened" — so
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
        node.boundary === undefined ||
        isVestingStartPlaceholder(node)
      )
        return;
      // The `boundary` carries `through` and the descriptor as one present-together
      // unit — exactly the assumption's payload minus `eventId` — so it spreads in
      // whole, with no defaulting and no invariant to police. A bare wait has no
      // `boundary` and was already skipped above.
      const assumption: AbsenceAssumption = {
        eventId: node.event,
        ...node.boundary,
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
