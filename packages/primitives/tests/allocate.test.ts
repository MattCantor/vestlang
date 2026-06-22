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
  // 2^53 itself is no longer legal input now that floorSharesAt enforces its
  // safe-integer precondition (R2-B23); the intermediate products q·k still
  // run far past 2^53 and the BigInt path handles them exactly.
  it("stays exact and telescopes at the largest safe magnitude", () => {
    const q = Number.MAX_SAFE_INTEGER; // 2^53 - 1, the largest legal totalShares
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

  it("rejects a degenerate (denominator < 1) fraction with a clear error", () => {
    // A 1/0 fraction would otherwise throw an opaque BigInt "Division by zero";
    // the precondition names what's wrong instead (issue #61).
    expect(() => floorSharesAt(5, { numerator: 1, denominator: 0 })).toThrow(
      /denominator must be >= 1/,
    );
  });
});

// R2-B23: the cast preconditions the doc comment used to assume are enforced.
// The bound sits on the quotient, not the cumulative — an over-allocating
// template compiles under an error finding, so cumulative > 1 is legal input
// and only a quotient Number() would round gets refused.
describe("floorSharesAt — enforced cast bounds (R2-B23)", () => {
  it("accepts an over-1 cumulative while the quotient fits", () => {
    expect(floorSharesAt(100, { numerator: 3, denominator: 2 })).toBe(150);
  });

  it("rejects an unsafe-integer totalShares (2^53 passes Number.isInteger)", () => {
    expect(() =>
      floorSharesAt(2 ** 53, { numerator: 1, denominator: 1 }),
    ).toThrow(/totalShares must be a safe integer/);
  });

  it("rejects a fractional totalShares with a named error, not a BigInt RangeError", () => {
    expect(() => floorSharesAt(1.5, { numerator: 1, denominator: 1 })).toThrow(
      /totalShares must be a safe integer/,
    );
  });

  it("refuses a quotient past MAX_SAFE_INTEGER instead of letting Number() round", () => {
    // The finding's example: floor(9007199254740990 × 3/2) = 13510798882111485,
    // odd and above 2^53 — Number() would round it to an even neighbor.
    expect(() =>
      floorSharesAt(9_007_199_254_740_990, { numerator: 3, denominator: 2 }),
    ).toThrow(/exceeds Number.MAX_SAFE_INTEGER/);
  });

  it("passes the largest legal quotient through exactly", () => {
    expect(
      floorSharesAt(Number.MAX_SAFE_INTEGER, { numerator: 1, denominator: 1 }),
    ).toBe(Number.MAX_SAFE_INTEGER);
  });
});
