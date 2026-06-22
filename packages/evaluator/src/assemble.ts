// assemble — turn a resolver/classifier verdict into the published EvaluatedSchedule,
// tagged by `status`. This is the last stage of the extended pipeline:
//
//   parse → normalize → resolve → classify → ASSEMBLE → EvaluatedSchedule
//
//   - template    → core.compile (exact-rational installments) + the canonical
//                   artifact (template, runtime, sourceMap), status "template".
//   - events      → the dated installments (plus any pending sibling's symbolic
//                   ones), status "events-only" + reason.
//   - unresolved  → symbolic installments + blockers, status "unresolved".
//   - impossible  → all-void installments + contradiction blockers, status
//                   "impossible".

import type {
  EvaluatedSchedule,
  EvaluatedScheduleVerdict,
  InterchangeVerdict,
} from "@vestlang/types";
import { compileToInstallments } from "@vestlang/core";
import { makeResolvedInstallment } from "./interpret/makeTranches.js";
import { partitionResolutionBlockers } from "./interpret/blockerTree.js";
import { collectAbsences } from "./interpret/absences.js";
import type { ResolveResult } from "./resolve/types.js";

/** Map a resolve verdict to its published EvaluatedSchedule arm (no findings yet).
 *  The resolver hands back a flat blocker list per arm; the partition into
 *  `pending` (still waiting) and `dead` (contradicted given the firings) happens
 *  here, once, at the closed-world boundary. */
const assembleVerdict = (result: ResolveResult): EvaluatedScheduleVerdict => {
  switch (result.kind) {
    case "template": {
      const compiled = compileToInstallments(
        result.template,
        result.totalShares,
        result.runtime,
      );
      // Pending witnesses (unfired atomic EVENT starts). A `template` can be
      // representable yet carry blockers + an empty/partial projection.
      const { pending, dead } = partitionResolutionBlockers(result.blockers);
      return {
        status: "template",
        template: result.template,
        runtime: result.runtime,
        sourceMap: result.sourceMap, // synthetic-event definitions (may be {})
        // Dated tranches first, then symbolic UNRESOLVED ones for any pending
        // EVENT-based statements (unfired atomic events / unsettled combinators).
        // The pending installments are empty when every statement has a known start.
        installments: [
          ...compiled.map((c) => makeResolvedInstallment(c.date, c.amount)),
          ...result.pendingInstallments,
        ],
        pending,
        dead,
      };
    }
    case "events": {
      // Pending siblings' witnesses; empty when every portion resolved to a date.
      const { pending, dead } = partitionResolutionBlockers(result.blockers);
      return {
        status: "events-only",
        installments: result.installments,
        // Structured reason, rendered to prose only at the view boundary.
        reason: result.reason,
        pending,
        dead,
      };
    }
    case "unresolved": {
      const { pending, dead } = partitionResolutionBlockers(result.blockers);
      return {
        status: "unresolved",
        installments: result.installments,
        pending,
        dead,
      };
    }
    case "impossible": {
      // The resolver's blockers here are all `ImpossibleBlocker`, so they land
      // wholly in `dead`; `pending` is `[]`.
      const { pending, dead } = partitionResolutionBlockers(result.blockers);
      return {
        status: "impossible",
        installments: result.installments,
        pending,
        dead,
      };
    }
  }
};

/**
 * Build the published EvaluatedSchedule from the two verdicts. The closed-world
 * `resolution` is assembled here from the resolve result; the firing-invariant
 * `interchange` is computed separately (see resolve/interchange.ts) and passed in.
 *
 * Findings come off the resolve result and ride at the top level — they're about
 * the schedule as written, not about either verdict. `absenceAssumptions` reads the
 * non-occurrences the closed-world `resolution` leaned on out of its own blockers.
 */
export const assemble = (
  resolution: ResolveResult,
  interchange: InterchangeVerdict,
): EvaluatedSchedule => ({
  interchange,
  resolution: assembleVerdict(resolution),
  absenceAssumptions: collectAbsences(resolution.blockers),
  findings: resolution.findings,
  cliffDate: resolution.cliffDate,
});
