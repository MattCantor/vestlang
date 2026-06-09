import { describe, it, expect } from "vitest";
import { blockerToString } from "../src/evaluate/blockerToString.js";

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
});
