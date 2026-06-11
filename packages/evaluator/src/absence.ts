import type { AbsenceAssumption } from "@vestlang/types";

// Reading a schedule under the events we currently know can quietly depend on some
// event still not having happened. `absenceAssumptions` records each such dependency
// as { eventId, through }; this turns one into a sentence a person can read. `view.ts`
// folds the wording into the published ScheduleView, so the phrasing stays in one place
// rather than being re-derived per surface.
export const formatAbsenceAssumption = (a: AbsenceAssumption): string =>
  `${a.eventId} did not occur on/before ${a.through}`;
