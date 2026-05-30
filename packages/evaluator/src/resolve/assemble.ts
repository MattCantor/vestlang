// assemble — turn a resolver/classifier verdict into the published EvaluatedSchedule,
// tagged by interchange fidelity. This is the last stage of the extended pipeline:
//
//   parse → normalize → resolve → classify → ASSEMBLE → EvaluatedSchedule
//
//   - template    → core.compile (exact-rational installments), fidelity "template".
//   - events      → the resolved dated installments, fidelity "events-only" + reason.
//   - unresolved  → symbolic installments + blockers, fidelity "unresolved".

import type { EvaluatedSchedule, OCTDate } from "@vestlang/types";
import { compileToInstallments } from "@vestlang/core";
import { makeResolvedInstallment } from "../evaluate/makeTranches.js";
import type { NonTemplateReason, ResolveResult } from "./types.js";

/** Human-readable reason a resolved schedule landed in events-only. */
const reasonToString = (r: NonTemplateReason): string => {
  switch (r.kind) {
    case "OVERLAPPING_ABSOLUTE_STARTS":
      return r.detail ?? "Two independent absolute-date vesting grids on one grant.";
    case "EVENT_CLIFF":
      return r.detail ?? `Event-anchored cliff on "${r.eventId}" has no template form.`;
    case "LOADED_ALLOCATION":
      return r.detail ?? `Loaded allocation mode "${r.mode}" has no canonical template form.`;
  }
};

/** Map a fidelity verdict to the published EvaluatedSchedule. */
export const assemble = (result: ResolveResult): EvaluatedSchedule => {
  switch (result.kind) {
    case "template": {
      const compiled = compileToInstallments(
        result.template,
        result.totalShares,
        result.runtime,
      );
      return {
        installments: compiled.map((c) =>
          makeResolvedInstallment(c.date as OCTDate, c.amount),
        ),
        blockers: [],
        fidelity: "template",
      };
    }
    case "events":
      return {
        installments: result.installments,
        blockers: [],
        fidelity: "events-only",
        reason: reasonToString(result.reason),
      };
    case "unresolved":
      return {
        installments: result.symbolic,
        blockers: result.blockers,
        fidelity: "unresolved",
      };
  }
};
