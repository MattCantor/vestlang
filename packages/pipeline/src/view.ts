// A "schedule view" is the trimmed, serializable shape of an evaluated schedule
// — the version a consumer (the CLI's tables, the MCP server's JSON) actually
// shows a user. It carries both verdicts side by side (what's storable, and what
// it resolves to today), the installments, the blockers, the findings (each with
// a human-readable message), the absence assumptions the resolution leaned on (also
// with a message), and the four orthogonal read-flags. It drops the engine's working
// state: the compiled template and the runtime inputs stay server-side.
//
// The one piece of template-arm working state that does survive is the `sourceMap`
// — the DSL behind any synthetic event the lowering had to mint when externalizing
// a gated or combinator-over-anchors start. Without it a consumer sees a template
// gated on an opaque `evt:<n>` with no way to read what it stands for, so it rides
// along on the template arm of each verdict (and is `{}` for a plain schedule).
//
// Both consumers used to build this object by hand, and drifted. This is the one
// place that derivation lives.

import type {
  AbsenceAssumption,
  Blocker,
  EvaluatedSchedule,
  EvaluatedScheduleVerdict,
  Finding,
  Installment,
  InterchangeVerdict,
  NonTemplateReason,
  SourceMap,
} from "@vestlang/types";
import { presentSchedule } from "./present.js";
import { formatFinding } from "./findings.js";
import { formatAbsenceAssumption } from "./absence.js";

/** Turn a structured "couldn't be one template" reason into a sentence for display.
 *  Both verdicts keep the reason structured all the way out to here; prose is
 *  rendered only at this boundary, so a consumer can still gate on the kind. Also
 *  used by the pipeline to render a rescued program's captured reason. */
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
    case "EVENT_CHAINED_TAIL":
      return (
        r.detail ??
        `A THEN segment chained behind a start waiting on event "${r.eventId}" can't be dated until that event fires.`
      );
    case "DEFERRED_CLIFF":
      return (
        r.detail ??
        "The cliff can only be placed once an event fires, so the schedule can't be stored ahead of time."
      );
  }
};

// The here-and-now verdict, against the events we currently know. `reason` rides
// along only on the events-only arm — it's what explains the fall back to bare
// events — so the type ties it to that status rather than leaving it a loose
// optional everywhere. The template arm carries the `sourceMap` (see header).
type ResolutionView =
  | { status: "template"; sourceMap: SourceMap }
  | { status: "unresolved" | "impossible" }
  | { status: "events-only"; reason: string };

// The storable-floor verdict, independent of which events have fired. Both the
// events-only and the unrepresentable arms carry a `reason` describing what kept
// it off a single template; the template arm carries the `sourceMap`.
type InterchangeView =
  | { status: "template"; sourceMap: SourceMap }
  | { status: "impossible" }
  | { status: "events-only" | "unrepresentable"; reason: string };

export type ScheduleView = {
  representable: boolean;
  pending: boolean;
  valid: boolean;
  resolution: ResolutionView;
  interchange: InterchangeView;
  // Each finding gets a rendered `message` alongside its structured fields.
  findings: Array<Finding & { message: string }>;
  // The non-occurrences the resolution leaned on, each with a rendered `message`
  // (same treatment as findings). Empty when nothing is being assumed absent.
  absenceAssumptions: Array<AbsenceAssumption & { message: string }>;
  // The projection is the resolution overlay's output. Widened to the full
  // Installment union: the serialized view doesn't care which arm (resolved /
  // unresolved / impossible) produced each one.
  installments: Installment[];
  blockers: Blocker[];
};

const resolutionView = (r: EvaluatedScheduleVerdict): ResolutionView => {
  switch (r.status) {
    case "template":
      return { status: r.status, sourceMap: r.sourceMap };
    case "events-only":
      return { status: r.status, reason: reasonToString(r.reason) };
    case "unresolved":
    case "impossible":
      return { status: r.status };
  }
};

const interchangeView = (i: InterchangeVerdict): InterchangeView => {
  switch (i.status) {
    case "events-only":
    case "unrepresentable":
      return { status: i.status, reason: reasonToString(i.reason) };
    case "template":
      return { status: i.status, sourceMap: i.sourceMap };
    case "impossible":
      return { status: i.status };
  }
};

export function toScheduleView(s: EvaluatedSchedule): ScheduleView {
  const { representable, pending, valid } = presentSchedule(s);
  return {
    representable,
    pending,
    valid,
    resolution: resolutionView(s.resolution),
    interchange: interchangeView(s.interchange),
    findings: s.findings.map((f) => ({ ...f, message: formatFinding(f) })),
    absenceAssumptions: s.absenceAssumptions.map((a) => ({
      ...a,
      message: formatAbsenceAssumption(a),
    })),
    installments: s.resolution.installments,
    blockers: s.resolution.blockers,
  };
}
