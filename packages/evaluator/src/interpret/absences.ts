// The non-occurrences a closed-world resolution is leaning on, derived from the
// blockers it left behind. Shared by two read-sites: `assemble.ts` (the full
// `evaluate` path, folding the whole resolution's blocker list) and
// `resolveVestingStart.ts` (the narrow `resolve_offset` path, folding a committed
// EARLIER_OF's own disclosures). Both want the same derivation, so it lives here
// once. Module-internal only — not re-exported from the package's public index.

import type { AbsenceAssumption, Blocker, OCTDate } from "@vestlang/types";
import { gt } from "@vestlang/primitives";
import { foldBlocker } from "./blockerTree.js";
import { isVestingStartPlaceholder } from "./vestingNode/vestingBase.js";

/**
 * Closed-world resolution reads "no firing on record" as "hasn't happened" — so
 * reading a schedule as, say, vested can quietly depend on some event still being
 * absent. We surface each such dependency from the given blockers: every "still
 * waiting on event X" blocker that got measured against a known date carries that
 * date, and the date is exactly how far we're assuming X stayed absent. A bare wait
 * with no date to compare against isn't a dated assumption, so it's left to the
 * blocker list rather than disclosed here; the vesting-start placeholder isn't a
 * real event and is never disclosed. When one event was held against several dates,
 * the latest wins — assuming absence through the later date is the stronger, safe
 * claim.
 */
export const collectAbsences = (blockers: Blocker[]): AbsenceAssumption[] => {
  const latest = new Map<string, OCTDate>();

  for (const top of blockers) {
    foldBlocker<void>(top, (node) => {
      if (
        node.type === "EVENT_NOT_YET_OCCURRED" &&
        node.through !== undefined &&
        !isVestingStartPlaceholder(node)
      ) {
        const prior = latest.get(node.event);
        if (prior === undefined || gt(node.through, prior))
          latest.set(node.event, node.through);
      }
    });
  }

  return [...latest.entries()]
    .map(([eventId, through]) => ({ eventId, through }))
    .sort((x, y) =>
      x.eventId < y.eventId ? -1 : x.eventId > y.eventId ? 1 : 0,
    );
};
