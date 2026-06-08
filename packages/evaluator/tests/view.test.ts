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
} from "@vestlang/types";
import { toScheduleView } from "../src/view";

// Same shortcut present.test.ts uses: toScheduleView reads only status /
// blockers / installments / findings (+ reason on the events-only arm), so stub
// the rest. Extra fields (e.g. reason) pass straight through the cast.
const stub = (fields: {
  status: EvaluatedSchedule["status"];
  blockers?: Blocker[];
  installments?: Installment[];
  findings?: Finding[];
  reason?: string;
}): EvaluatedSchedule =>
  ({
    blockers: [],
    installments: [],
    findings: [],
    ...fields,
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
  it("carries reason on the events-only arm", () => {
    const view = toScheduleView(
      stub({ status: "events-only", reason: "overlapping starts" }),
    );
    expect(view.status).toBe("events-only");
    // narrow before reading reason — it only exists on this arm
    if (view.status === "events-only") {
      expect(view.reason).toBe("overlapping starts");
    }
  });

  it("omits reason on the template / unresolved / impossible arms", () => {
    for (const status of ["template", "unresolved", "impossible"] as const) {
      const view = toScheduleView(stub({ status }));
      expect("reason" in view).toBe(false);
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
