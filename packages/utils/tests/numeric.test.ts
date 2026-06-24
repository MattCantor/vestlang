import { describe, it, expect } from "vitest";
import {
  apportionStored,
  fractionToNumeric,
  isNumeric,
  numericToFraction,
  tryNumericToFraction,
  validateNumeric,
  terminates,
  renderFixed,
} from "../src/numeric";
import type { Fraction, Numeric } from "@vestlang/types";
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

describe("the MAX_SAFE_INTEGER ceiling", () => {
  // Grammar-valid but too big to hold exactly as a number-based Fraction.
  const oversized = "99999999999999999999" as Numeric;

  it("numericToFraction throws rather than rounding past MAX_SAFE", () => {
    expect(() => numericToFraction(oversized)).toThrow(/MAX_SAFE/);
  });

  it("tryNumericToFraction returns null where numericToFraction throws", () => {
    expect(tryNumericToFraction(oversized)).toBeNull();
  });

  it("allows a value reducing to exactly MAX_SAFE — the ceiling is inclusive", () => {
    const atCeiling: Numeric = String(Number.MAX_SAFE_INTEGER); // 2^53 − 1
    const exact = { numerator: Number.MAX_SAFE_INTEGER, denominator: 1 };
    expect(numericToFraction(atCeiling)).toEqual(exact);
    expect(tryNumericToFraction(atCeiling)).toEqual(exact);
  });
});

describe("tryNumericToFraction — graceful refusal", () => {
  it("returns the exact fraction for a well-formed value", () => {
    expect(tryNumericToFraction("0.25")).toEqual({
      numerator: 1,
      denominator: 4,
    });
  });

  it("returns null for a string outside the grammar instead of throwing", () => {
    expect(tryNumericToFraction("1e-5")).toBeNull();
  });
});

describe("fractionToNumeric — domain guards", () => {
  it('writes a zero numerator as "0" (zero is in domain, not rejected)', () => {
    expect(fractionToNumeric({ numerator: 0, denominator: 1 })).toBe("0");
  });

  it("throws on a non-positive denominator", () => {
    expect(() =>
      fractionToNumeric({ numerator: 1, denominator: -2 }),
    ).toThrow();
  });
});

describe("terminates", () => {
  it("is true iff the denominator's only prime factors are 2 and 5", () => {
    expect(terminates(5n)).toBe(true); // 1/5 = 0.2
    expect(terminates(8n)).toBe(true); // 1/8 = 0.125
    expect(terminates(40n)).toBe(true); // 2^3 · 5
    expect(terminates(3n)).toBe(false); // 1/3 repeats
    expect(terminates(6n)).toBe(false); // factor 3 remains
  });
});

describe("renderFixed", () => {
  it("renders an integer numerator over 10^places, padding sub-1 values", () => {
    expect(renderFixed(5n, 0)).toBe("5"); // no point at zero places
    expect(renderFixed(125n, 3)).toBe("0.125");
    expect(renderFixed(25n, 2)).toBe("0.25");
  });
});

describe("apportionStored — schedule-whole share lowering (#413)", () => {
  const f = (numerator: number, denominator: number): Fraction => ({
    numerator,
    denominator,
  });

  // The total parsed back from the stored set, as an exact rational over 10^10.
  const sumStored = (stored: Numeric[]): Fraction =>
    stored.reduce<Fraction>(
      (acc, n) => {
        const fr = numericToFraction(n);
        return {
          numerator:
            acc.numerator * fr.denominator + fr.numerator * acc.denominator,
          denominator: acc.denominator * fr.denominator,
        };
      },
      { numerator: 0, denominator: 1 },
    );

  it("three exact thirds store a set that sums to exactly 1 (the deficit is handed back)", () => {
    const stored = apportionStored([f(1, 3), f(1, 3), f(1, 3)]);
    // The earliest statement carries the +1-ulp bump (ascending tie-break).
    expect(stored).toEqual(["0.3333333334", "0.3333333333", "0.3333333333"]);
    const total = sumStored(stored);
    expect(total.numerator).toBe(total.denominator); // exactly 1
  });

  it("terminating shares are unchanged — no spurious bump", () => {
    expect(apportionStored([f(1, 2), f(1, 2)])).toEqual(["0.5", "0.5"]);
    expect(apportionStored([f(1, 4), f(3, 4)])).toEqual(["0.25", "0.75"]);
  });

  it("a lone 100% statement stores as the exact 1", () => {
    expect(apportionStored([f(1, 1)])).toEqual(["1"]);
  });

  it("an empty set apportions to nothing", () => {
    expect(apportionStored([])).toEqual([]);
  });

  it("sevenths recover their lost ulps too (the largest remainders win)", () => {
    const stored = apportionStored([f(1, 7), f(2, 7), f(4, 7)]);
    const total = sumStored(stored);
    expect(total.numerator).toBe(total.denominator); // sums to exactly 1
  });

  it("under-summing literal decimals are stored faithfully — nothing invented", () => {
    // Three hand-typed 0.3333333333 already sum below 1; the deficit is ≤ 0, so the
    // apportionment stores exactly what was authored and lets the under-allocation
    // gate speak.
    const typed = f(3333333333, 10000000000);
    const stored = apportionStored([typed, typed, typed]);
    expect(stored).toEqual(["0.3333333333", "0.3333333333", "0.3333333333"]);
  });

  it("over-summing shares are stored as-is (the persist gate refuses, not this helper)", () => {
    // 0.6 + 0.6 over-allocates; apportionStored must not throw — it stores faithfully.
    expect(apportionStored([f(3, 5), f(3, 5)])).toEqual(["0.6", "0.6"]);
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
