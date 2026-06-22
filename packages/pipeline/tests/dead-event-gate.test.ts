// #287 — a vesting gate whose date constraints are JOINTLY empty (their windows
// don't overlap) is a static contradiction: no firing of any referenced event, on
// any date, lands in an empty window. Before this fix the evaluator's per-operand
// combiner missed it — each conjunct is individually a satisfiable "wait, bounded
// on one side" — so an event-anchored start with such a gate reported a storable,
// pending template, while a fixed-DATE anchor with the same contradiction already
// reported `impossible`. The joint interval analysis (lifted from the linter into
// `@vestlang/core`) runs once at the gated-node entry and classifies the node
// impossible, in BOTH verdicts (empty-window is firing-invariant), for start gates
// and cliff gates alike.
//
// Each test crystallizes one acceptance criterion from docs/scratch/issue-287.md.

import { describe, it, expect } from "vitest";
import type { ResolutionContextInput, Program } from "@vestlang/types";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram } from "@vestlang/evaluator";
import { presentSchedule } from "../src/present";

const evalDsl = (dsl: string, events: Record<string, string> = {}) => {
  const program: Program = normalizeProgram(parse(dsl));
  const ctx: ResolutionContextInput = {
    grantDate: "2025-01-01",
    events,
    grantQuantity: 4800,
  };
  return evaluateProgram(program, ctx);
};

// The empty-window start used by AC#1–#3: ipo gated to fall after 2026 and before
// 2025 — no date can be both.
const DEAD_START =
  "VEST FROM EVENT ipo AFTER DATE 2026-01-01 AND BEFORE DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS";

describe("#287 — jointly-empty date gate is impossible", () => {
  it("AC#1: start storable verdict flips (no firings)", () => {
    const s = evalDsl(DEAD_START);
    expect(s.interchange.status).toBe("impossible");
    expect(presentSchedule(s).representable).toBe(false);
  });

  it("AC#2: start resolves-to verdict flips coherently, exactly one blocker (no firings)", () => {
    const s = evalDsl(DEAD_START);
    expect(s.resolution.status).toBe("impossible");
    expect(
      s.resolution.dead.some((b) => b.type === "IMPOSSIBLE_CONDITION"),
    ).toBe(true);
    expect(s.resolution.pending).toHaveLength(0);

    // Exactly one new impossible blocker — the joint check runs once at the
    // gated-node entry, not once per recursion level of the AND combiner.
    expect(s.resolution.dead).toHaveLength(1);
    if (s.interchange.status === "impossible") {
      expect(s.interchange.blockers).toHaveLength(1);
    }

    const p = presentSchedule(s);
    expect(p.dead).toBe(true);
    expect(p.pending).toBe(false);
  });

  it("AC#3: firing-invariant — any firing of ipo still reports impossible", () => {
    for (const date of ["2024-06-01", "2025-06-01", "2027-01-01"]) {
      const s = evalDsl(DEAD_START, { ipo: date });
      expect(s.interchange.status).toBe("impossible");
      expect(s.resolution.status).toBe("impossible");
    }
  });

  it("AC#4: cliff-gate analogue — the joint analysis, provably not #294's per-operand path", () => {
    // Dated start, event-anchored cliff whose two date conjuncts are EACH
    // individually satisfiable (after 2026 alone, before 2025 alone), so the
    // per-operand moot-operand collapse from #294 structurally cannot fire — and
    // there's no concrete cliff date to test the bounds against. Only the joint
    // interval analysis sees the windows don't overlap. A dead gate stops being an
    // event cliff: the gate node goes IMPOSSIBLE, and with a dated start the all-
    // void rollup makes the whole schedule impossible.
    const s = evalDsl(
      "VEST FROM DATE 2025-01-01 OVER 48 MONTHS EVERY 1 MONTH " +
        "CLIFF EVENT ipo AFTER DATE 2026-01-01 AND BEFORE DATE 2025-01-01",
    );
    expect(s.interchange.status).toBe("impossible");
    expect(s.resolution.status).toBe("impossible");
  });

  it("AC#5: no false positive — a satisfiable gate is unchanged", () => {
    // Start: a single AFTER bound leaves a non-empty half-line, so it stays a
    // storable, pending template.
    const start = evalDsl(
      "VEST FROM EVENT ipo AFTER DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS",
    );
    expect(start.interchange.status).toBe("template");
    expect(presentSchedule(start).pending).toBe(true);
    expect(presentSchedule(start).dead).toBe(false);

    // Cliff: a satisfiable event cliff now stores as a template (event_condition),
    // so the storable verdict is `template` and the resolves-to verdict is a held
    // `template` while ipo is unfired — live, never killed.
    const cliff = evalDsl(
      "VEST FROM DATE 2025-01-01 OVER 48 MONTHS EVERY 1 MONTH " +
        "CLIFF EVENT ipo AFTER DATE 2026-01-01",
    );
    expect(cliff.interchange.status).toBe("template");
    expect(cliff.resolution.status).toBe("template");
  });
});
