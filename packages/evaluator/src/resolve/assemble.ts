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
  AbsenceAssumption,
  Blocker,
  EvaluatedSchedule,
  EvaluatedScheduleVerdict,
  InterchangeVerdict,
  NonTemplateReason,
  OCTDate,
} from "@vestlang/types";
import { compileToInstallments, gt } from "@vestlang/core";
import { makeResolvedInstallment } from "../evaluate/makeTranches.js";
import { foldBlocker } from "../evaluate/blockerTree.js";
import { isVestingStartPlaceholder } from "../evaluate/vestingNode/vestingBase.js";
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

/**
 * The non-occurrences this resolution is leaning on. Closed-world resolution reads
 * "no firing on record" as "hasn't happened" — so reading a schedule as, say,
 * vested can quietly depend on some event still being absent. We surface each such
 * dependency from the blockers the resolution left behind: every "still waiting on
 * event X" blocker that got measured against a known date carries that date, and
 * the date is exactly how far we're assuming X stayed absent. A bare wait with no
 * date to compare against isn't a dated assumption, so it's left to the blocker
 * list rather than disclosed here; the vesting-start placeholder isn't a real event
 * and is never disclosed. When one event was held against several dates, the latest
 * wins — assuming absence through the later date is the stronger, safe claim.
 */
const collectAbsences = (blockers: Blocker[]): AbsenceAssumption[] => {
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
        // Pending siblings' witnesses; empty when every portion resolved to a date.
        blockers: result.blockers,
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
});
