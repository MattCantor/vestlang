// assemble — turn a resolver/classifier verdict into the published EvaluatedSchedule,
// tagged by `status`. This is the last stage of the extended pipeline:
//
//   parse → normalize → resolve → classify → ASSEMBLE → EvaluatedSchedule
//
//   - template    → core.compile (exact-rational installments) + the canonical
//                   artifact (template, runtime, sourceMap), status "template".
//   - events      → the resolved dated installments, status "events-only" + reason.
//   - unresolved  → symbolic installments + blockers, status "unresolved".
//   - impossible  → all-void installments + contradiction blockers, status
//                   "impossible".

import type { EvaluatedSchedule } from "@vestlang/types";
import { compileToInstallments } from "@vestlang/core";
import { makeResolvedInstallment } from "../evaluate/makeTranches.js";
import type { NonTemplateReason, ResolveResult } from "./types.js";

/** Human-readable reason a resolved schedule landed in events-only. */
const reasonToString = (r: NonTemplateReason): string => {
  switch (r.kind) {
    case "OVERLAPPING_ABSOLUTE_STARTS":
      return (
        r.detail ?? "Two independent absolute-date vesting grids on one grant."
      );
    case "EVENT_CLIFF":
      return (
        r.detail ??
        `Event-anchored cliff on "${r.eventId}" has no template form.`
      );
    case "LOADED_ALLOCATION":
      return (
        r.detail ??
        `Loaded allocation mode "${r.mode}" has no canonical template form.`
      );
  }
};

/** Map a resolve verdict to the published EvaluatedSchedule. */
export const assemble = (result: ResolveResult): EvaluatedSchedule => {
  switch (result.kind) {
    case "template": {
      const compiled = compileToInstallments(
        result.template,
        result.totalShares,
        result.runtime,
      );
      return {
        status: "template",
        template: result.template,
        runtime: result.runtime,
        sourceMap: result.sourceMap, // synthetic-event definitions (may be {})
        installments: compiled.map((c) =>
          makeResolvedInstallment(c.date, c.amount),
        ),
        // Pending witnesses (unfired atomic EVENT starts). A `template` can be
        // representable yet carry blockers + an empty/partial projection.
        blockers: result.blockers,
      };
    }
    case "events":
      return {
        status: "events-only",
        installments: result.installments,
        reason: reasonToString(result.reason),
        blockers: [],
      };
    case "unresolved":
      return {
        status: "unresolved",
        installments: result.symbolic,
        blockers: result.blockers,
      };
    case "impossible":
      return {
        status: "impossible",
        installments: result.installments,
        blockers: result.blockers,
      };
  }
};
