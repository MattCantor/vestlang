// A "schedule view" is the trimmed, serializable shape of an evaluated schedule
// — the version a consumer (the CLI's tables, the MCP server's JSON) actually
// shows a user. It carries both verdicts side by side (what's storable, and what
// it resolves to today), the installments, the blockers, the findings (each with
// a human-readable message), the absence assumptions the resolution leaned on (also
// with a message), and the four orthogonal read-flags. It drops the engine's working
// state: the compiled template, the runtime inputs, and the source map all stay
// server-side.
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
} from "@vestlang/types";
import { presentSchedule } from "./present.js";
import { reasonToString } from "./resolve/assemble.js";
import { formatFinding } from "./findings.js";
import { formatAbsenceAssumption } from "./absence.js";

// The here-and-now verdict, against the events we currently know. `reason` rides
// along only on the events-only arm — it's what explains the fall back to bare
// events — so the type ties it to that status rather than leaving it a loose
// optional everywhere.
type ResolutionView =
  | { status: "template" | "unresolved" | "impossible" }
  | { status: "events-only"; reason: string };

// The storable-floor verdict, independent of which events have fired. Both the
// events-only and the unrepresentable arms carry a `reason` describing what kept
// it off a single template.
type InterchangeView =
  | { status: "template" | "impossible" }
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

const resolutionView = (r: EvaluatedScheduleVerdict): ResolutionView =>
  r.status === "events-only"
    ? { status: r.status, reason: r.reason }
    : { status: r.status };

const interchangeView = (i: InterchangeVerdict): InterchangeView => {
  switch (i.status) {
    case "events-only":
    case "unrepresentable":
      return { status: i.status, reason: reasonToString(i.reason) };
    case "template":
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
