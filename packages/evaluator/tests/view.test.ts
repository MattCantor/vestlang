// toScheduleView projects an evaluated schedule down to the serializable shape
// the consumers display. It delegates the four read-flags to presentSchedule and
// folds a rendered message into every finding; here we pin the projection
// itself — what survives, what's dropped, and that `reason` rides only on the
// events-only arm.

import { describe, it, expect } from "vitest";
import type {
  Blocker,
  EvaluatedSchedule,
  Finding,
  Installment,
  InterchangeVerdict,
  Status,
} from "@vestlang/types";
import { toScheduleView } from "../src/view";

// The view carries both verdicts. We stub the resolution side (status, blockers,
// installments, the events-only reason) and let the interchange side default to a
// plain template; a test that cares about the storable verdict passes its own.
// Everything is cast through `unknown`, so the stub only has to carry the fields
// toScheduleView actually reads.
const stub = (fields: {
  status: Status;
  blockers?: Blocker[];
  installments?: Installment[];
  findings?: Finding[];
  reason?: string;
  interchange?: InterchangeVerdict;
}): EvaluatedSchedule =>
  ({
    interchange: fields.interchange ?? { status: "template" },
    resolution: {
      status: fields.status,
      blockers: fields.blockers ?? [],
      installments: fields.installments ?? [],
      ...(fields.reason !== undefined ? { reason: fields.reason } : {}),
    },
    absenceAssumptions: [],
    findings: fields.findings ?? [],
  }) as unknown as EvaluatedSchedule;

const dated: Installment[] = [
  { amount: 100, date: "2025-02-01", meta: { state: "RESOLVED" } },
];
const eventBlocker: Blocker[] = [
  { type: "EVENT_NOT_YET_OCCURRED", event: "ipo" },
];
const overAllocated: Finding[] = [
  {
    kind: "over-allocation",
    severity: "error",
    sum: { numerator: 3, denominator: 2 },
    path: ["Program"],
  },
];

describe("toScheduleView", () => {
  it("carries the resolution reason on the events-only arm", () => {
    const view = toScheduleView(
      stub({ status: "events-only", reason: "overlapping starts" }),
    );
    expect(view.resolution.status).toBe("events-only");
    // narrow before reading reason — it only exists on this arm
    if (view.resolution.status === "events-only") {
      expect(view.resolution.reason).toBe("overlapping starts");
    }
  });

  it("omits the resolution reason on the template / unresolved / impossible arms", () => {
    for (const status of ["template", "unresolved", "impossible"] as const) {
      const view = toScheduleView(stub({ status }));
      expect("reason" in view.resolution).toBe(false);
    }
  });

  it("surfaces the interchange verdict alongside the resolution one", () => {
    // An event cliff is events-only when you read against known events, but has no
    // storable form, so the two verdicts differ — the view shows both.
    const view = toScheduleView(
      stub({
        status: "events-only",
        reason: "event-anchored cliff",
        interchange: {
          status: "unrepresentable",
          reason: { kind: "EVENT_CLIFF", eventId: "ipo" },
        },
      }),
    );
    expect(view.resolution.status).toBe("events-only");
    expect(view.interchange.status).toBe("unrepresentable");
    if (view.interchange.status === "unrepresentable") {
      expect(view.interchange.reason).toContain("ipo");
    }
  });

  it("folds a rendered message into each finding, keeping the structured fields", () => {
    const view = toScheduleView(
      stub({
        status: "template",
        installments: dated,
        findings: overAllocated,
      }),
    );
    expect(view.findings).toHaveLength(1);
    const [f] = view.findings;
    expect(f.kind).toBe("over-allocation"); // original field preserved
    expect(f.message).toContain("150%"); // formatFinding output
    expect(f.message).toContain("not a valid schedule");
  });

  it("tracks presentSchedule's reads and drops projected", () => {
    // An error-severity finding flips valid false while representable stays true.
    const view = toScheduleView(
      stub({
        status: "template",
        installments: dated,
        findings: overAllocated,
      }),
    );
    expect(view.representable).toBe(true);
    expect(view.valid).toBe(false);
    // the engine-only `projected` flag is not part of the published view
    expect("projected" in view).toBe(false);
  });

  it("passes installments and blockers through unchanged", () => {
    const view = toScheduleView(
      stub({ status: "template", installments: dated, blockers: eventBlocker }),
    );
    expect(view.installments).toEqual(dated);
    expect(view.blockers).toEqual(eventBlocker);
  });
});
