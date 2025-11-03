import { describe, it, expect } from "vitest";
import { blockerToString } from "../src/evaluate/blockerToString.js";
import { OCTDate } from "@vestlang/types";

describe("blockerToString", () => {
  it("EVENT_NOT_YET_OCCURRED", () => {
    const s = blockerToString({
      type: "EVENT_NOT_YET_OCCURRED",
      event: "milestone",
    });
    expect(s).toBe("EVENT milestone");
  });

  it("DATE_NOT_YET_OCCURRED", () => {
    const s = blockerToString({
      type: "DATE_NOT_YET_OCCURRED",
      date: "2024-02-01" as OCTDate,
    });
    expect(s).toBe("DATE 2024-02-01");
  });

  it("UNRESOLVED_SELECTOR LATER_OF (nested)", () => {
    const s = blockerToString({
      type: "UNRESOLVED_SELECTOR",
      selector: "LATER_OF",
      blockers: [
        { type: "EVENT_NOT_YET_OCCURRED", event: "milestone" },
        { type: "DATE_NOT_YET_OCCURRED", date: "2024-03-15" as OCTDate },
      ],
    } as any);
    expect(s).toBe("LATER OF ( EVENT milestone, DATE 2024-03-15 )");
  });
});
