import { describe, it, expect } from "vitest";
import { blockerToString } from "../src/evaluate/blockerToString.js";
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
});
