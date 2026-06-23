import { describe, it, expect } from "vitest";
import {
  fractionToNumeric,
  isNumeric,
  numericToFraction,
  validateNumeric,
} from "../src/numeric";
import { analyzePrecision } from "../src/precision";

// The OCF Numeric boundary: parse a stored decimal to its exact rational on the
// way in, render an exact rational as the shortest faithful decimal on the way
// out. Crystallizes issue #359 AC2, AC3, and the analyzer anchor of AC7.

describe("numericToFraction — parse the OCF grammar to the exact rational (AC2)", () => {
  it("parses integers and decimals to their exact reduced fraction", () => {
    expect(numericToFraction("3")).toEqual({ numerator: 3, denominator: 1 });
    expect(numericToFraction("0.3333")).toEqual({
      numerator: 3333,
      denominator: 10000,
    });
    expect(numericToFraction("0.321")).toEqual({
      numerator: 321,
      denominator: 1000,
    });
    expect(numericToFraction("1.00")).toEqual({
      numerator: 1,
      denominator: 1,
    });
    expect(numericToFraction("-0.5")).toEqual({
      numerator: -1,
      denominator: 2,
    });
  });

  it("reads the grammar's permissive forms canonically rather than rejecting them", () => {
    // The OCF pattern admits a leading +, leading zeros, and a signed zero; we
    // parse each to its value (the persist regex agrees they are well-formed).
    expect(numericToFraction("+3")).toEqual({ numerator: 3, denominator: 1 });
    expect(numericToFraction("01")).toEqual({ numerator: 1, denominator: 1 });
    expect(numericToFraction("-0")).toEqual({ numerator: 0, denominator: 1 });
  });

  it("rejects forms outside the OCF grammar", () => {
    expect(() => numericToFraction("1e-05")).toThrow(); // scientific notation
    expect(() => numericToFraction(".5")).toThrow(); // leading dot
    expect(() => numericToFraction("0.12345678901")).toThrow(); // >10 dp
  });
});

describe("fractionToNumeric — render an exact rational to a Numeric (AC3)", () => {
  it("writes a fraction that terminates within 10 places exactly, in minimal form", () => {
    expect(fractionToNumeric({ numerator: 1, denominator: 2 })).toBe("0.5");
    expect(fractionToNumeric({ numerator: 1, denominator: 4 })).toBe("0.25");
    expect(fractionToNumeric({ numerator: 3, denominator: 8 })).toBe("0.375");
    expect(fractionToNumeric({ numerator: 1, denominator: 1 })).toBe("1");
  });

  it("truncates a repeating or over-long fraction to 10 places (toward zero)", () => {
    expect(fractionToNumeric({ numerator: 1, denominator: 3 })).toBe(
      "0.3333333333",
    );
    expect(fractionToNumeric({ numerator: 2, denominator: 3 })).toBe(
      "0.6666666666",
    );
    // 1/2048 = 0.00048828125 terminates but needs 11 places, so it truncates.
    expect(fractionToNumeric({ numerator: 1, denominator: 2048 })).toBe(
      "0.0004882812",
    );
  });

  it("throws on a negative input (the producers never pass one)", () => {
    expect(() =>
      fractionToNumeric({ numerator: -1, denominator: 2 }),
    ).toThrow();
  });

  it("round-trips a terminating fraction exactly", () => {
    for (const f of [
      { numerator: 1, denominator: 2 },
      { numerator: 3, denominator: 4 },
      { numerator: 3, denominator: 8 },
      { numerator: 7, denominator: 20 },
    ]) {
      expect(numericToFraction(fractionToNumeric(f))).toEqual(f);
    }
  });
});

describe("isNumeric / validateNumeric — the boundary guard", () => {
  it("accepts well-formed Numeric strings and rejects everything else", () => {
    expect(isNumeric("0.25")).toBe(true);
    expect(isNumeric("1")).toBe(true);
    expect(isNumeric("1e-5")).toBe(false);
    expect(isNumeric(".5")).toBe(false);
    expect(isNumeric("0.12345678901")).toBe(false);
    expect(isNumeric({ numerator: 1, denominator: 4 })).toBe(false);
    expect(isNumeric(0.25)).toBe(false);
  });

  it("validateNumeric returns the string when valid, throws when not", () => {
    expect(validateNumeric("0.5")).toBe("0.5");
    expect(() => validateNumeric("1e-5")).toThrow();
  });
});

describe("analyzePrecision — the AC7 anchor", () => {
  it("flags a truncated 1/3 cliff at 36000 shares and recommends 0.33334", () => {
    const verdict = analyzePrecision("0.3333333333", 36000);
    expect(verdict.kind).toBe("misallocates");
    if (verdict.kind === "misallocates") {
      expect(verdict.recommended).toBe("0.33334");
    }
  });

  it("raises no concern for a terminating percentage", () => {
    expect(analyzePrecision("0.25", 36000).kind).toBe("terminating");
  });
});
