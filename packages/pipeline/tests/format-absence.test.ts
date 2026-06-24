import { describe, it, expect } from "vitest";
import type { AbsenceAssumption } from "@vestlang/types";
import { formatAbsenceAssumption } from "../src/absence";

// The disclosure sentence must be direction-honest across all four
// {direction, inclusive} combinations — the watch-list reader trusts the prose to
// name the side actually at risk. Each cell renders a distinct sentence: `direction`
// picks before/after, `inclusive` picks whether the boundary day is named ("on/").
const THROUGH = "2025-01-01";
const at = (
  direction: "before" | "after",
  inclusive: boolean,
): AbsenceAssumption => ({
  eventId: "ipo",
  through: THROUGH,
  direction,
  inclusive,
});

describe("formatAbsenceAssumption", () => {
  it("renders the four direction × strictness cells direction-honestly", () => {
    expect(formatAbsenceAssumption(at("before", false))).toBe(
      "ipo did not occur before 2025-01-01",
    );
    expect(formatAbsenceAssumption(at("before", true))).toBe(
      "ipo did not occur on/before 2025-01-01",
    );
    expect(formatAbsenceAssumption(at("after", false))).toBe(
      "ipo did not occur after 2025-01-01",
    );
    expect(formatAbsenceAssumption(at("after", true))).toBe(
      "ipo did not occur on/after 2025-01-01",
    );
  });

  it("renders all four cells as distinct sentences", () => {
    const sentences = [
      formatAbsenceAssumption(at("before", false)),
      formatAbsenceAssumption(at("before", true)),
      formatAbsenceAssumption(at("after", false)),
      formatAbsenceAssumption(at("after", true)),
    ];
    expect(new Set(sentences).size).toBe(4);
  });
});
