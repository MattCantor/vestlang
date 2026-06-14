// toScheduleView projects an evaluated schedule down to the serializable shape
// the consumers display. It delegates the four read-flags to presentSchedule and
// folds a rendered message into every finding; here we pin the projection
// itself — what survives, what's dropped, and that `reason` rides only on the
// events-only arm.

import { describe, it, expect } from "vitest";
import type {
  AbsenceAssumption,
  EvaluatedSchedule,
  Finding,
  Installment,
  InterchangeVerdict,
  NonTemplateReason,
  ResolutionStatus,
  SourceMap,
} from "@vestlang/types";
import { toScheduleView } from "../src/view";

// The view carries both verdicts. We stub the resolution side (status, the two
// blocker lists, installments, the events-only reason, the template-arm source map)
// and let the interchange side default to a plain template; a test that cares about
// the storable verdict passes its own. The whole object is cast through `unknown`,
// so the stub carries plain blocker shapes — no need to brand them here (and the
// brand cast is confined to the evaluator anyway).
const stub = (fields: {
  status: ResolutionStatus;
  pending?: unknown[];
  dead?: unknown[];
  installments?: Installment[];
  findings?: Finding[];
  reason?: NonTemplateReason;
  sourceMap?: SourceMap;
  interchange?: InterchangeVerdict;
  absenceAssumptions?: AbsenceAssumption[];
}): EvaluatedSchedule =>
  ({
    interchange: fields.interchange ?? {
      status: "template",
      sourceMap: fields.sourceMap ?? {},
    },
    resolution: {
      status: fields.status,
      pending: fields.pending ?? [],
      dead: fields.dead ?? [],
      installments: fields.installments ?? [],
      ...(fields.reason !== undefined ? { reason: fields.reason } : {}),
      ...(fields.status === "template"
        ? { sourceMap: fields.sourceMap ?? {} }
        : {}),
    },
    absenceAssumptions: fields.absenceAssumptions ?? [],
    findings: fields.findings ?? [],
    cliffDate: null,
  }) as unknown as EvaluatedSchedule;

const dated: Installment[] = [
  { state: "RESOLVED", amount: 100, date: "2025-02-01" },
];
const eventBlocker = [{ type: "EVENT_NOT_YET_OCCURRED", event: "ipo" }];
// A contradiction — read by the view as a resolution-space dead blocker. Carried as
// a plain shape; the stub coerces the whole schedule through `unknown`.
const deadBlocker = [{ type: "IMPOSSIBLE_CONDITION", node: {} }];
const overAllocated: Finding[] = [
  {
    kind: "over-allocation",
    severity: "error",
    sum: { numerator: 3, denominator: 2 },
    path: ["Program"],
  },
];

describe("toScheduleView", () => {
  it("renders the structured resolution reason to prose on the events-only arm", () => {
    // The resolution arm carries the reason structured now; the view is where it
    // becomes a sentence, so a consumer upstream can still gate on the kind.
    const view = toScheduleView(
      stub({
        status: "events-only",
        reason: { kind: "OVERLAPPING_ABSOLUTE_STARTS" },
      }),
    );
    expect(view.resolution.status).toBe("events-only");
    // narrow before reading reason — it only exists on this arm
    if (view.resolution.status === "events-only") {
      expect(view.resolution.reason).toBe(
        "Two independent absolute-date vesting grids on one grant.",
      );
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
        reason: { kind: "EVENT_CLIFF", eventId: "ipo" },
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

  it("carries the synthetic-event source map on both template arms", () => {
    // A gated start lowers to a template gated on a synthetic event; the source
    // map records the DSL that event stands in for, so a consumer can read it
    // back. It rides on the template arm of each verdict.
    const sourceMap = {
      "evt:1": { definition: "DATE 2025-01-01 BEFORE EVENT ipo" },
    };
    const view = toScheduleView(stub({ status: "template", sourceMap }));
    if (view.resolution.status === "template") {
      expect(view.resolution.sourceMap).toEqual(sourceMap);
    } else {
      throw new Error("expected template resolution");
    }
    if (view.interchange.status === "template") {
      expect(view.interchange.sourceMap).toEqual(sourceMap);
    } else {
      throw new Error("expected template interchange");
    }
  });

  it("carries an empty source map on a plain (non-synthetic) template", () => {
    const view = toScheduleView(stub({ status: "template" }));
    if (view.resolution.status === "template") {
      expect(view.resolution.sourceMap).toEqual({});
    }
    if (view.interchange.status === "template") {
      expect(view.interchange.sourceMap).toEqual({});
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

  it("passes installments and the two blocker lists through unchanged", () => {
    const view = toScheduleView(
      stub({
        status: "template",
        installments: dated,
        pending: eventBlocker,
      }),
    );
    expect(view.installments).toEqual(dated);
    expect(view.pendingBlockers).toEqual(eventBlocker);
    expect(view.deadBlockers).toEqual([]);
    expect(view.pending).toBe(true);
    expect(view.dead).toBe(false);
  });

  it("surfaces dead blockers under deadBlockers, flips the dead flag", () => {
    // A schedule whose resolution carries a contradiction (one statement dead given
    // the firings) — the view exposes it under deadBlockers, not pendingBlockers,
    // and the dead read-flag reflects it.
    const view = toScheduleView(
      stub({ status: "unresolved", dead: deadBlocker }),
    );
    expect(view.deadBlockers).toEqual(deadBlocker);
    expect(view.pendingBlockers).toEqual([]);
    expect(view.dead).toBe(true);
    expect(view.pending).toBe(false);
  });

  it("folds a rendered message into each absence assumption, keeping its fields", () => {
    const view = toScheduleView(
      stub({
        status: "template",
        absenceAssumptions: [{ eventId: "ipo", through: "2025-01-01" }],
      }),
    );
    expect(view.absenceAssumptions).toHaveLength(1);
    const [a] = view.absenceAssumptions;
    expect(a.eventId).toBe("ipo"); // structured fields preserved
    expect(a.through).toBe("2025-01-01");
    expect(a.message).toBe("ipo did not occur on/before 2025-01-01");
  });

  it("leaves absenceAssumptions empty when the schedule assumes nothing", () => {
    const view = toScheduleView(stub({ status: "template" }));
    expect(view.absenceAssumptions).toEqual([]);
  });
});
