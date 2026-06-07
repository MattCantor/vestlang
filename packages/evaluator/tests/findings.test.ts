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
});
