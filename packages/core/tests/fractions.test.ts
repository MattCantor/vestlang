import { describe, it, expect } from "vitest";
import { fracSum, fracCmp, ONE } from "../src/fractions";
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
});
