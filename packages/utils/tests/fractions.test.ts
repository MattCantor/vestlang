import { describe, it, expect } from "vitest";
import {
  fracSum,
  fracCmp,
  fracMul,
  fracAdd,
  fracSub,
  fracReduce,
  classifyAllocation,
  formatPct,
  ONE,
} from "../src/fractions";
import type { Fraction } from "@vestlang/types";

const f = (numerator: number, denominator: number): Fraction => ({
  numerator,
  denominator,
});

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
});

describe("fracCmp", () => {
  it("orders less / equal / greater", () => {
    expect(fracCmp(f(1, 2), f(3, 4))).toBe(-1);
    expect(fracCmp(f(2, 4), f(1, 2))).toBe(0); // equal even when unreduced
    expect(fracCmp(f(3, 4), f(1, 2))).toBe(1);
  });

  it("reads 3/2 as over one and 1/1 as exactly one", () => {
    expect(fracCmp(f(3, 2), ONE)).toBe(1);
    expect(fracCmp(ONE, ONE)).toBe(0);
    expect(fracCmp(f(3, 4), ONE)).toBe(-1);
  });

  it("stays exact when the cross products would overflow Number", () => {
    // 1/(2^53−1) vs 1/(2^53): in Number the two cross products both round to
    // the same value and the comparison reads equal; in BigInt the larger
    // denominator is strictly smaller. Numerator 1 keeps both reduced.
    const big = Number.MAX_SAFE_INTEGER; // 2^53 − 1
    expect(fracCmp(f(1, big), f(1, big - 1))).toBe(-1);
    expect(fracCmp(f(1, big - 1), f(1, big))).toBe(1);
  });
});

describe("overflow", () => {
  it("throws when a reduced component exceeds Number.MAX_SAFE_INTEGER", () => {
    // Two coprime large denominators: the product can't reduce away, so the
    // result lands past the safe-integer ceiling and must be refused rather
    // than rounded.
    const a = f(1, 9_007_199_254_740_881); // a prime below 2^53
    const b = f(1, 9_007_199_254_740_847); // a different prime below 2^53
    expect(() => fracMul(a, b)).toThrow(/Number\.MAX_SAFE_INTEGER/);
  });

  it("does not throw when reduction brings components back in range", () => {
    // Numerators and denominators that individually overflow when multiplied,
    // but share factors that reduce the result down to a safe pair.
    const big = 3_000_000_000; // 3e9; 3e9 × 3e9 = 9e18 > 2^53 before reducing
    const a = f(big, big);
    const b = f(big, big);
    expect(fracMul(a, b)).toEqual({ numerator: 1, denominator: 1 });
  });

  it("allows a component exactly at MAX_SAFE_INTEGER — the ceiling is inclusive", () => {
    // 2^53 − 1 is the largest value Number holds exactly; it must be accepted,
    // not refused as if it overflowed.
    expect(fracReduce(f(Number.MAX_SAFE_INTEGER, 1))).toEqual({
      numerator: Number.MAX_SAFE_INTEGER,
      denominator: 1,
    });
  });

  it("keeps a long running sum of equal slices exact past 2^53", () => {
    // 37 slices of 1/37 of a ~1.2e14 grant: scaled to per-share fractions the
    // denominators reach grant × 37 ≈ 4.5e15 > 2^53. The running total must
    // still telescope to exactly 1/1.
    const total = 123_456_789_012_345;
    const slice = f(1, total); // one share of the grant
    let sum: Fraction = { numerator: 0, denominator: 1 };
    for (let i = 0; i < total && i < 37; i++) sum = fracAdd(sum, slice);
    // 37 shares of the grant, reduced:
    expect(sum).toEqual({ numerator: 37, denominator: total });
  });
});

describe("fracSub", () => {
  it("subtracts to a reduced positive result", () => {
    expect(fracSub(f(3, 4), f(1, 4))).toEqual({ numerator: 1, denominator: 2 });
  });

  it("goes negative when the subtrahend is larger, carrying the sign on the numerator", () => {
    // 1/4 − 1/2 = −1/4. The reduction runs the GCD over a negative numerator, so
    // the sign rides the numerator and the denominator stays positive.
    expect(fracSub(f(1, 4), f(1, 2))).toEqual({
      numerator: -1,
      denominator: 4,
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
