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

  it("rejects a quantity past Number.MAX_SAFE_INTEGER", () => {
    // Number("9007199254740993") rounds to 2^53 before any check can see the
    // authored digits; isSafeInteger refuses the rounded value.
    const r = parseQuantity("9007199254740993");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/at most 9007199254740991/);
  });

  it("accepts the largest safe quantity", () => {
    const r = parseQuantity(String(Number.MAX_SAFE_INTEGER));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.quantity).toBe(Number.MAX_SAFE_INTEGER);
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
