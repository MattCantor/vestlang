import type { AbsenceAssumption } from "@vestlang/types";

// Reading a schedule under the events we currently know can quietly depend on some
// event still not having happened. `absenceAssumptions` records each such dependency
// direction-aware ({ eventId, through, direction, inclusive }); this turns one into a
// sentence a person can read. The sentence names the side a dangerous firing falls on
// — "before"/"after" the boundary — so the watch-list reads honestly: a `BEFORE`/
// EARLIER OF disclosure warns about a firing on the before side, an `AFTER`/LATER OF
// one about the after side. `inclusive` decides whether the boundary day itself is in
// the warned window ("on/before" vs "before"). `view.ts` folds the wording into the
// published ScheduleView, so the phrasing stays in one place rather than being
// re-derived per surface.
export const formatAbsenceAssumption = (a: AbsenceAssumption): string => {
  const edge =
    a.direction === "before"
      ? a.inclusive
        ? "on/before"
        : "before"
      : a.inclusive
        ? "on/after"
        : "after";
  return `${a.eventId} did not occur ${edge} ${a.through}`;
};
