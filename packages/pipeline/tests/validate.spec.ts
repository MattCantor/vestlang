import { describe, it, expect } from "vitest";
import { parseQuantity, validateDate } from "../src/validate";

describe("parseQuantity", () => {
  it("accepts a non-negative whole number", () => {
    const r = parseQuantity("100");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.quantity).toBe(100);
  });

  it("rejects negatives, fractions, and non-numbers", () => {
    for (const bad of ["-1", "1.5", "abc"]) {
      const r = parseQuantity(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.ruleId).toBe("evaluation-error");
    }
  });
});

describe("validateDate", () => {
  it("accepts a real calendar date", () => {
    const r = validateDate("2025-01-15");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.date).toBe("2025-01-15");
  });

  it("rejects an impossible date that the bare regex would let through", () => {
    const r = validateDate("2025-02-31");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.ruleId).toBe("evaluation-error");
  });
});
