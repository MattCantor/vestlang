import { describe, it, expect } from "vitest";
import type { Finding } from "@vestlang/types";
import { formatFinding } from "../src/findings";

describe("formatFinding", () => {
  it("renders an over-allocation as a percentage and a fraction", () => {
    const f: Finding = {
      kind: "over-allocation",
      severity: "error",
      sum: { numerator: 3, denominator: 2 },
      path: ["Program"],
    };
    const msg = formatFinding(f);
    expect(msg).toContain("150%");
    expect(msg).toContain("3/2");
    expect(msg).toContain("not a valid schedule");
  });

  it("renders an under-allocation", () => {
    const f: Finding = {
      kind: "under-allocation",
      severity: "warning",
      sum: { numerator: 1, denominator: 2 },
      path: ["Program"],
    };
    const msg = formatFinding(f);
    expect(msg).toContain("50%");
    expect(msg).toContain("1/2");
  });

  it("renders a precision-insufficient finding with a recommended decimal", () => {
    const f: Finding = {
      kind: "precision-insufficient",
      severity: "warning",
      percentage: "0.3333333333",
      shareCount: 36000,
      inferred: { numerator: 1, denominator: 3 },
      recommended: "0.33334",
      path: ["statements", 0, "cliff"],
    };
    expect(formatFinding(f)).toBe(
      "stored percentage `0.3333333333` is too imprecise for 36000 shares — " +
        "it reads as 1/3 (33%); store `0.33334` to allocate it correctly",
    );
  });

  it("renders a precision-insufficient finding with no representable decimal", () => {
    const f: Finding = {
      kind: "precision-insufficient",
      severity: "warning",
      percentage: "0.3333333333",
      shareCount: 30000000000,
      inferred: { numerator: 1, denominator: 3 },
      // recommended omitted: no ≤10-place decimal lands the count at this size.
      path: ["statements", 0, "cliff"],
    };
    expect(formatFinding(f)).toBe(
      "stored percentage `0.3333333333` is too imprecise for 30000000000 shares — " +
        "it reads as 1/3 (33%) and no ≤10-place decimal allocates it correctly",
    );
  });
});
