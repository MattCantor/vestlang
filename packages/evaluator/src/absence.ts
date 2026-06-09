import type { AbsenceAssumption } from "@vestlang/types";

// Reading a schedule under the events we currently know can quietly depend on some
// event still not having happened. `absenceAssumptions` records each such dependency
// as { eventId, through }; this turns one into a sentence a person can read. Like
// formatFinding, every surface (the CLI, the MCP output, the docs Playground) calls
// this instead of wording it themselves, so the phrasing stays in one place.
export const formatAbsenceAssumption = (a: AbsenceAssumption): string =>
  `${a.eventId} did not occur on/before ${a.through}`;
