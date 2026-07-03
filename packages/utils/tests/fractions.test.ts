import { describe, it, expect } from "vitest";
import {
  fracSum,
  fracReduce,
  classifyAllocation,
  formatPct,
  bigCmp,
  bigSub,
  toBigRational,
} from "../src/fractions";
import type { Fraction } from "@vestlang/types";

const f = (numerator: number, denominator: number): Fraction => ({
  numerator,
  denominator,
});
// A BigRational built from a Fraction, for exercising the BigInt-space ops.
const br = (numerator: number, denominator: number) =>
  toBigRational(f(numerator, denominator));

describe("fracSum", () => {
  it("sums an empty list to zero", () => {
    expect(fracSum([])).toEqual({ numerator: 0, denominator: 1 });
  });

  it("returns a singleton in reduced form", () => {
    expect(fracSum([f(2, 4)])).toEqual({ numerator: 1, denominator: 2 });
  });

  it("adds 3/4 + 3/4 to 3/2", () => {
    expect(fracSum([f(3, 4), f(3, 4)])).toEqual({
      numerator: 3,
      denominator: 2,
    });
  });

  it("adds three thirds back to one", () => {
    expect(fracSum([f(1, 3), f(1, 3), f(1, 3)])).toEqual({
      numerator: 1,
      denominator: 1,
    });
  });

  it("keeps a long running sum of equal slices exact past 2^53", () => {
    // 37 slices of 1/total of a ~1.2e14 grant: the intermediate cross-product
    // denominators reach total² ≫ 2^53, yet each step reduces back and the
    // running total telescopes to exactly 37/total.
    const total = 123_456_789_012_345;
    const slice = f(1, total); // one share of the grant
    expect(fracSum(Array.from({ length: 37 }, () => slice))).toEqual({
      numerator: 37,
      denominator: total,
    });
  });
});

describe("overflow guard", () => {
  it("throws when an exact sum's reduced denominator exceeds Number.MAX_SAFE_INTEGER", () => {
    // Two in-range fractions with coprime denominators near 2^53: the exact sum
    // is (p+q)/(pq), whose denominator can't reduce away, so it lands past the
    // safe-integer ceiling and must be refused rather than rounded. This is the
    // mid-arithmetic overflow the guard exists to catch, not an out-of-range input.
    const a = f(1, 9_007_199_254_740_881); // a prime below 2^53
    const b = f(1, 9_007_199_254_740_847); // a different prime below 2^53
    expect(() => fracSum([a, b])).toThrow(/Number\.MAX_SAFE_INTEGER/);
  });

  it("does not throw when reduction brings the sum's components back in range", () => {
    // (big−1)/big + 1/big = big/big: the cross-product intermediates reach big²
    // (≫ 2^53) before reducing, but the reduced result is 1/1, safely in range.
    const big = 3_000_000_000; // 3e9; big² = 9e18 > 2^53 before reducing
    expect(fracSum([f(big - 1, big), f(1, big)])).toEqual({
      numerator: 1,
      denominator: 1,
    });
  });

  it("accepts a component exactly at MAX_SAFE_INTEGER — the ceiling is inclusive", () => {
    // 2^53 − 1 is the largest value a Number holds exactly; it must be accepted,
    // not refused as if it overflowed.
    expect(fracReduce(f(Number.MAX_SAFE_INTEGER, 1))).toEqual({
      numerator: Number.MAX_SAFE_INTEGER,
      denominator: 1,
    });
  });
});

describe("bigCmp", () => {
  it("orders less / equal / greater, not requiring reduced operands", () => {
    expect(bigCmp(br(1, 2), br(3, 4))).toBe(-1);
    expect(bigCmp(br(2, 4), br(1, 2))).toBe(0); // equal even when unreduced
    expect(bigCmp(br(3, 4), br(1, 2))).toBe(1);
  });

  it("stays exact when the cross products would overflow Number", () => {
    // 1/(2^53−1) vs 1/(2^53−2): in Number the two cross products both round to
    // the same value and the comparison reads equal; in BigInt the larger
    // denominator is strictly smaller. Numerator 1 keeps both reduced.
    const big = Number.MAX_SAFE_INTEGER; // 2^53 − 1
    expect(bigCmp(br(1, big), br(1, big - 1))).toBe(-1);
    expect(bigCmp(br(1, big - 1), br(1, big))).toBe(1);
  });
});

describe("bigSub", () => {
  it("subtracts to a reduced positive result", () => {
    expect(bigSub(br(3, 4), br(1, 4))).toEqual({
      numerator: 1n,
      denominator: 2n,
    });
  });

  it("goes negative when the subtrahend is larger, carrying the sign on the numerator", () => {
    // 1/4 − 1/2 = −1/4. The reduction runs the GCD over a negative numerator, so
    // the sign rides the numerator and the denominator stays positive.
    expect(bigSub(br(1, 4), br(1, 2))).toEqual({
      numerator: -1n,
      denominator: 4n,
    });
  });
});

describe("fracReduce", () => {
  it("reduces to lowest terms, keeping the sign on the numerator", () => {
    expect(fracReduce(f(6, 4))).toEqual({ numerator: 3, denominator: 2 });
    expect(fracReduce(f(-6, 4))).toEqual({ numerator: -3, denominator: 2 });
  });
});

describe("classifyAllocation", () => {
  it("names over / under / exact against the whole grant", () => {
    expect(classifyAllocation(f(3, 2))).toBe("over");
    expect(classifyAllocation(f(1, 2))).toBe("under");
    expect(classifyAllocation(f(1, 1))).toBe("exact");
  });
});

describe("formatPct", () => {
  it("renders a fraction as a rounded whole percent", () => {
    expect(formatPct(f(3, 2))).toBe("150%");
    expect(formatPct(f(1, 1))).toBe("100%");
    expect(formatPct(f(1, 3))).toBe("33%"); // rounded from 33.33…
  });
});
