import { describe, it, expect } from "vitest";
import {
  allocateVector,
  allocateExact,
  floorSharesAt,
  roundSharesAt,
} from "../src/allocate";

describe("allocateVector — loaded modes (parity with legacy allocateQuantity)", () => {
  // Expected values mirror evaluator/tests/allocation.test.ts; the loaded modes
  // are identical integer base+remainder logic, so they match at all magnitudes.
  it("n <= 0 returns []", () => {
    expect(allocateVector(100, 0, "CUMULATIVE_ROUND_DOWN")).toEqual([]);
  });

  it("FRONT_LOADED remainder lands at the front", () => {
    expect(allocateVector(10, 4, "FRONT_LOADED")).toEqual([3, 3, 2, 2]);
  });

  it("BACK_LOADED remainder lands at the back", () => {
    expect(allocateVector(10, 4, "BACK_LOADED")).toEqual([2, 2, 3, 3]);
  });

  it("FRONT_LOADED_TO_SINGLE_TRANCHE", () => {
    expect(allocateVector(10, 4, "FRONT_LOADED_TO_SINGLE_TRANCHE")).toEqual([
      4, 2, 2, 2,
    ]);
  });

  it("BACK_LOADED_TO_SINGLE_TRANCHE", () => {
    expect(allocateVector(10, 4, "BACK_LOADED_TO_SINGLE_TRANCHE")).toEqual([
      2, 2, 2, 4,
    ]);
  });
});

describe("allocateVector — cumulative modes", () => {
  it("CUMULATIVE_ROUND_DOWN sums to quantity", () => {
    const result = allocateVector(100, 6, "CUMULATIVE_ROUND_DOWN");
    expect(result.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("CUMULATIVE_ROUNDING sums to quantity (legacy parity case)", () => {
    const result = allocateVector(100, 6, "CUMULATIVE_ROUNDING");
    expect(result.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("CUMULATIVE_ROUND_DOWN: 100 over 6 telescopes evenly with remainder at the end", () => {
    // floor(100·k/6): 16,33,50,66,83,100 → diffs 16,17,17,16,17,17
    expect(allocateVector(100, 6, "CUMULATIVE_ROUND_DOWN")).toEqual([
      16, 17, 17, 16, 17, 17,
    ]);
  });

  it("CUMULATIVE_ROUNDING: 100 over 6 (round-half-up of 100·k/6)", () => {
    // round(100·k/6): 17,33,50,67,83,100 → diffs 17,16,17,17,16,17
    expect(allocateVector(100, 6, "CUMULATIVE_ROUNDING")).toEqual([
      17, 16, 17, 17, 16, 17,
    ]);
  });

  // Exact-rational beyond float's safe range: where legacy float
  // Math.floor((i+1)/n*q) would drift, the BigInt path stays exact.
  it("stays exact and telescopes at large magnitude", () => {
    const q = 9_007_199_254_740_992; // 2^53, > Number.MAX_SAFE_INTEGER (2^53 - 1)
    const n = 7;
    const v = allocateVector(q, n, "CUMULATIVE_ROUND_DOWN");
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

describe("allocateExact + share rounding primitives", () => {
  it("floorSharesAt floors totalShares × fraction exactly", () => {
    expect(floorSharesAt(100, { numerator: 1, denominator: 3 })).toBe(33);
    expect(floorSharesAt(100, { numerator: 1, denominator: 1 })).toBe(100);
  });

  it("roundSharesAt rounds half up", () => {
    expect(roundSharesAt(100, { numerator: 1, denominator: 3 })).toBe(33);
    expect(roundSharesAt(100, { numerator: 1, denominator: 6 })).toBe(17); // 16.67 → 17
    expect(roundSharesAt(1, { numerator: 1, denominator: 2 })).toBe(1); // .5 → 1
  });

  it("allocateExact round-down telescopes via vestedSoFar", () => {
    // first step of 100/3: floor(100/3) - 0 = 33
    expect(allocateExact(100, { numerator: 1, denominator: 3 }, 0)).toBe(33);
    // second cumulative 2/3: floor(66.67) - 33 = 66 - 33 = 33
    expect(allocateExact(100, { numerator: 2, denominator: 3 }, 33)).toBe(33);
  });

  it("allocateExact throws on non-cumulative modes", () => {
    expect(() =>
      allocateExact(100, { numerator: 1, denominator: 2 }, 0, "FRONT_LOADED"),
    ).toThrow(/does not support/);
  });
});
