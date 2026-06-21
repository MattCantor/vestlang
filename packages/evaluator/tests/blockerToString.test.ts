import { describe, it, expect } from "vitest";
import type { ResolutionContextInput } from "@vestlang/types";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { blockerToString } from "../src/evaluate/blockerToString.js";
import { evaluateProgram } from "../src/index.js";
import {
  makeDuration,
  makeImpossibleConditionBlocker,
  makeVestingBaseDate,
} from "./helpers.js";

describe("blockerToString", () => {
  it("EVENT_NOT_YET_OCCURRED", () => {
    const s = blockerToString({
      type: "EVENT_NOT_YET_OCCURRED",
      event: "milestone",
    });
    expect(s).toBe("EVENT milestone");
  });

  it("UNRESOLVED_SELECTOR LATER_OF (nested)", () => {
    const s = blockerToString({
      type: "UNRESOLVED_SELECTOR",
      selector: "LATER_OF",
      blockers: [
        { type: "EVENT_NOT_YET_OCCURRED", event: "milestone" },
        { type: "EVENT_NOT_YET_OCCURRED", event: "ipo" },
      ],
    });
    expect(s).toBe("LATER OF ( EVENT milestone, EVENT ipo )");
  });

  // The condition payload is rendered by `@vestlang/render`, so a magnitude-1
  // offset singularizes ("+1 month", not the "+1 months" the old hand-rolled
  // printer emitted).
  it("CONDITION delegates to render's node printer", () => {
    const s = blockerToString(
      makeImpossibleConditionBlocker(makeVestingBaseDate("2025-01-01"), [
        makeDuration(1, "MONTHS", "PLUS"),
      ]),
    );
    expect(s).toBe("DATE 2025-01-01 +1 month");
  });

  // #287 — a jointly-empty date gate (its windows don't overlap) has no single atom
  // to blame, so its IMPOSSIBLE_CONDITION blocker carries the *whole* gated node.
  // End-to-end: evaluate the dead gate, then render the blocker the evaluator
  // actually produced — it must show the full gate, not a stripped conjunct. Catches
  // both a node that drops the gate and a printer that drops the condition.
  it("renders a jointly-empty gate blocker as the whole gate (#287)", () => {
    const ctx: ResolutionContextInput = {
      grantDate: "2025-01-01",
      events: {},
      grantQuantity: 4800,
    };
    const schedule = evaluateProgram(
      normalizeProgram(
        parse(
          "VEST FROM EVENT ipo AFTER DATE 2026-01-01 AND BEFORE DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS",
        ),
      ),
      ctx,
    );
    const blocker = schedule.resolution.dead.find(
      (b) => b.type === "IMPOSSIBLE_CONDITION",
    );
    expect(blocker).toBeDefined();
    const s = blockerToString(blocker!);
    expect(s).toContain("EVENT ipo");
    expect(s).toContain("AFTER DATE 2026-01-01");
    expect(s).toContain("BEFORE DATE 2025-01-01");
  });
});
