import { describe, it, expect } from "vitest";
import type { AbsenceAssumption } from "@vestlang/types";
import { formatAbsenceAssumption } from "../src/absence";

// The disclosure sentence must be direction-honest across all four
// {direction, inclusive} combinations — the watch-list reader trusts the prose to
// name the side actually at risk. Each cell renders a distinct sentence: `direction`
// picks before/after, `inclusive` picks whether the boundary day is named ("on/").
// `consequence` then appends a clause; the cells below all use grid-shift so the four
// stems stay the comparison, and the consequence-specific clauses get their own test.
const THROUGH = "2025-01-01";
const at = (
  direction: "before" | "after",
  inclusive: boolean,
  consequence: "grid-shift" | "flips-to-impossible" = "grid-shift",
): AbsenceAssumption => ({
  eventId: "ipo",
  through: THROUGH,
  direction,
  inclusive,
  consequence,
});

describe("formatAbsenceAssumption", () => {
  it("renders the four direction × strictness cells direction-honestly", () => {
    expect(formatAbsenceAssumption(at("before", false))).toBe(
      "ipo did not occur before 2025-01-01 — a contradicting firing would shift the schedule",
    );
    expect(formatAbsenceAssumption(at("before", true))).toBe(
      "ipo did not occur on/before 2025-01-01 — a contradicting firing would shift the schedule",
    );
    expect(formatAbsenceAssumption(at("after", false))).toBe(
      "ipo did not occur after 2025-01-01 — a contradicting firing would shift the schedule",
    );
    expect(formatAbsenceAssumption(at("after", true))).toBe(
      "ipo did not occur on/after 2025-01-01 — a contradicting firing would shift the schedule",
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

  // AC-5: the consequence clause is appended verbatim, direction-neutral (it reads
  // right whether the danger is a later or a backdated firing). Pin both exact strings.
  it("appends the consequence clause for each value", () => {
    expect(
      formatAbsenceAssumption(at("after", false, "flips-to-impossible")),
    ).toBe(
      "ipo did not occur after 2025-01-01 — a contradicting firing would void the grant",
    );
    expect(formatAbsenceAssumption(at("after", false, "grid-shift"))).toBe(
      "ipo did not occur after 2025-01-01 — a contradicting firing would shift the schedule",
    );
  });

  // AC-7 (the #399 "renders identically" gap, closed end to end): a gate and a selector
  // can share eventId/through/direction/inclusive and used to render the SAME sentence;
  // folding consequence into the prose makes them distinct.
  it("two records differing only in consequence render distinct sentences", () => {
    const flips = formatAbsenceAssumption(
      at("after", false, "flips-to-impossible"),
    );
    const shift = formatAbsenceAssumption(at("after", false, "grid-shift"));
    expect(flips).not.toBe(shift);
  });
});
