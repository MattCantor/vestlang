// The one ISO-date schema the server validates against. Both the live tool inputs
// (server.ts) and the persisted-artifact schema (persist.ts) import it, so a
// caller-supplied date and a stored-artifact date get the identical check — the
// regex shape plus the real-calendar refine from @vestlang/utils. Single-sourcing
// it here is what keeps the two surfaces from drifting (the bug behind #231, where
// the artifact schema was regex-only and let an impossible `2025-02-31` through).

import { z } from "zod";
import { isValidCalendarDate } from "@vestlang/utils";

export const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD")
  .refine(isValidCalendarDate, "must be a real calendar date (YYYY-MM-DD)");
