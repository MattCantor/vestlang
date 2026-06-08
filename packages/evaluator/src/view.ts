// A "schedule view" is the trimmed, serializable shape of an evaluated schedule
// — the version a consumer (the CLI's tables, the MCP server's JSON) actually
// shows a user. It keeps the installments, the blockers, the findings (each with
// a human-readable message), and the four orthogonal read-flags, but drops the
// engine's working state: the compiled template, the runtime inputs, and the
// source map all stay server-side.
//
// Both consumers used to build this object by hand, and drifted. This is the one
// place that derivation lives.

import type {
  Blocker,
  EvaluatedSchedule,
  Finding,
  Installment,
} from "@vestlang/types";
import { presentSchedule } from "./present.js";
import { formatFinding } from "./findings.js";

type ScheduleViewCommon = {
  representable: boolean;
  pending: boolean;
  valid: boolean;
  // Each finding gets a rendered `message` alongside its structured fields.
  findings: Array<Finding & { message: string }>;
  // Widened to the full Installment union: the serialized view doesn't care
  // which arm (resolved / unresolved / impossible) produced each one.
  installments: Installment[];
  blockers: Blocker[];
};

// `reason` only exists on the events-only arm (it explains why the schedule fell
// back to bare events), so it's tied to that status rather than left a
// free-floating optional — `{ status: "template", reason }` stays unrepresentable.
export type ScheduleView = ScheduleViewCommon &
  (
    | { status: "template" | "unresolved" | "impossible" }
    | { status: "events-only"; reason: string }
  );

export function toScheduleView(s: EvaluatedSchedule): ScheduleView {
  const { representable, pending, valid } = presentSchedule(s);
  const common: ScheduleViewCommon = {
    representable,
    pending,
    valid,
    findings: s.findings.map((f) => ({ ...f, message: formatFinding(f) })),
    installments: s.installments,
    blockers: s.blockers,
  };
  switch (s.status) {
    case "events-only":
      return { ...common, status: s.status, reason: s.reason };
    case "template":
    case "unresolved":
    case "impossible":
      return { ...common, status: s.status };
  }
}
