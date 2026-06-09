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

import type {
  EvaluatedSchedule,
  EvaluatedScheduleVerdict,
  InterchangeVerdict,
  NonTemplateReason,
} from "@vestlang/types";
import { compileToInstallments } from "@vestlang/core";
import { makeResolvedInstallment } from "../evaluate/makeTranches.js";
import type { ResolveResult } from "./types.js";

/** Turn a structured "couldn't be one template" reason into a sentence for display.
 *  Shared by both verdicts, so the same code reads the same wherever it surfaces. */
export const reasonToString = (r: NonTemplateReason): string => {
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
    case "DEFERRED_CLIFF":
      return (
        r.detail ??
        "The cliff can only be placed once an event fires, so the schedule can't be stored ahead of time."
      );
  }
};

/** Map a resolve verdict to its published EvaluatedSchedule arm (no findings yet). */
const assembleVerdict = (result: ResolveResult): EvaluatedScheduleVerdict => {
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
        installments: result.installments,
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

/**
 * Build the published EvaluatedSchedule from the two verdicts. The closed-world
 * `resolution` is assembled here from the resolve result; the firing-invariant
 * `interchange` is computed separately (see resolve/interchange.ts) and passed in.
 *
 * Findings come off the resolve result and ride at the top level — they're about
 * the schedule as written, not about either verdict. `absenceAssumptions` is left
 * empty for now; a later phase fills it from the closed-world evaluation.
 */
export const assemble = (
  resolution: ResolveResult,
  interchange: InterchangeVerdict,
): EvaluatedSchedule => ({
  interchange,
  resolution: assembleVerdict(resolution),
  absenceAssumptions: [],
  findings: resolution.findings,
});
