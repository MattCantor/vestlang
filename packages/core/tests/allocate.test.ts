import { describe, it, expect } from "vitest";
import { allocateVector, allocateExact, floorSharesAt } from "../src/allocate";

describe("allocateVector — cumulative round-down", () => {
  it("n <= 0 returns []", () => {
    expect(allocateVector(100, 0)).toEqual([]);
  });

  it("sums to quantity", () => {
    const result = allocateVector(100, 6);
    expect(result.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("100 over 6 telescopes with the remainder folded across steps", () => {
    // floor(100·k/6): 16,33,50,66,83,100 → diffs 16,17,17,16,17,17
    expect(allocateVector(100, 6)).toEqual([16, 17, 17, 16, 17, 17]);
  });

  // Exact-rational beyond float's safe range: where legacy float
  // Math.floor((i+1)/n*q) would drift, the BigInt path stays exact.
  it("stays exact and telescopes at large magnitude", () => {
    const q = 9_007_199_254_740_992; // 2^53, > Number.MAX_SAFE_INTEGER (2^53 - 1)
    const n = 7;
    const v = allocateVector(q, n);
    // telescopes exactly
    expect(v.reduce((a, b) => a + b, 0)).toBe(q);
    // cumulative is monotonic non-decreasing
    let cum = 0;
    let prev = -1;
    for (const amt of v) {
      cum += amt;
      expect(cum).toBeGreaterThanOrEqual(prev);
      prev = cum;
    }
  });
});

describe("allocateExact + floorSharesAt", () => {
  it("floorSharesAt floors totalShares × fraction exactly", () => {
    expect(floorSharesAt(100, { numerator: 1, denominator: 3 })).toBe(33);
    expect(floorSharesAt(100, { numerator: 1, denominator: 1 })).toBe(100);
  });

  it("allocateExact round-down telescopes via vestedSoFar", () => {
    // first step of 100/3: floor(100/3) - 0 = 33
    expect(allocateExact(100, { numerator: 1, denominator: 3 }, 0)).toBe(33);
    // second cumulative 2/3: floor(66.67) - 33 = 66 - 33 = 33
    expect(allocateExact(100, { numerator: 2, denominator: 3 }, 33)).toBe(33);
  });
});
