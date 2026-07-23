import { describe, it, expect } from "vitest";
import {
  apportionStored,
  fractionToNumeric,
  isNumeric,
  numericToFraction,
  tryNumericToFraction,
  validateNumeric,
  renderFixed,
} from "../src/numeric";
import type { Fraction, Numeric } from "@vestlang/types";
import { analyzePrecision } from "../src/precision";

// The OCF Numeric boundary: parse a stored decimal to its exact rational on the
// way in, render an exact rational onto the ten-place storage grid on the way out.

describe("numericToFraction — parse the OCF grammar to the exact rational", () => {
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

describe("fractionToNumeric — render an exact rational to a Numeric", () => {
  it("writes a fraction that lands on the ten-place grid exactly, in minimal form", () => {
    expect(fractionToNumeric({ numerator: 1, denominator: 2 })).toBe("0.5");
    expect(fractionToNumeric({ numerator: 1, denominator: 4 })).toBe("0.25");
    expect(fractionToNumeric({ numerator: 3, denominator: 8 })).toBe("0.375");
    expect(fractionToNumeric({ numerator: 1, denominator: 1 })).toBe("1");
  });

  it("rounds a repeating or over-long fraction UP to the next grid value", () => {
    // Up, so the share math's floor lands on the intended count instead of a
    // share short of it.
    expect(fractionToNumeric({ numerator: 1, denominator: 3 })).toBe(
      "0.3333333334",
    );
    expect(fractionToNumeric({ numerator: 2, denominator: 3 })).toBe(
      "0.6666666667",
    );
    // 1/2048 = 0.00048828125 terminates but needs 11 places, so it rounds too.
    expect(fractionToNumeric({ numerator: 1, denominator: 2048 })).toBe(
      "0.0004882813",
    );
  });

  it("carries the round-up out of the tenth place instead of growing an eleventh", () => {
    // 1 − 10^-11 rounds to a whole 1. Bumping the last of ten accumulated digits
    // would carry into an eleven-place string the grammar rejects.
    const justUnderOne = { numerator: 99999999999, denominator: 100000000000 };
    const rendered = fractionToNumeric(justUnderOne);
    expect(rendered).toBe("1");
    expect(isNumeric(rendered)).toBe(true);
  });

  it("trims the zeros the round-up itself produces", () => {
    // 0.12345678995 rounds to 0.1234567900 — the trailing zeros have to go after
    // the rounding, not before it.
    const rendered = fractionToNumeric({
      numerator: 12345678995,
      denominator: 100000000000,
    });
    expect(rendered).toBe("0.12345679");
    expect(isNumeric(rendered)).toBe(true);
  });

  it("throws on a negative input (the producers never pass one)", () => {
    expect(() =>
      fractionToNumeric({ numerator: -1, denominator: 2 }),
    ).toThrow();
  });

  it("round-trips a fraction that fits the grid exactly", () => {
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

describe("renderFixed", () => {
  it("renders an integer numerator over 10^places, padding sub-1 values", () => {
    expect(renderFixed(5n, 0)).toBe("5"); // no point at zero places
    expect(renderFixed(125n, 3)).toBe("0.125");
    expect(renderFixed(25n, 2)).toBe("0.25");
  });
});

describe("apportionStored — schedule-whole share lowering", () => {
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

  it("three exact thirds store a set that sums to exactly 1", () => {
    const stored = apportionStored([f(1, 3), f(1, 3), f(1, 3)]);
    // Only the running totals are rounded up, so the first boundary carries the
    // extra ulp and the individual shares behind it read a hair low.
    expect(stored).toEqual(["0.3333333334", "0.3333333333", "0.3333333333"]);
    const total = sumStored(stored);
    expect(total.numerator).toBe(total.denominator); // exactly 1
  });

  it("rounds each running boundary up, so a partial schedule still gains the ulp", () => {
    // A lone third is under 100%, which is legal — and it must still store the
    // rounded-up value, or every under-allocating schedule keeps losing its share.
    expect(apportionStored([f(1, 3)])).toEqual(["0.3333333334"]);
    expect(apportionStored([f(1, 3), f(1, 3)])).toEqual([
      "0.3333333334",
      "0.3333333333",
    ]);
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

  it("sevenths keep the whole grant too", () => {
    const stored = apportionStored([f(1, 7), f(2, 7), f(4, 7)]);
    const total = sumStored(stored);
    expect(total.numerator).toBe(total.denominator); // sums to exactly 1
  });

  it("under-summing literal decimals are stored faithfully — nothing invented", () => {
    // Three hand-typed 0.3333333333 already sit on the grid, so every boundary is
    // exact and nothing is rounded; the under-allocation gate speaks downstream.
    const typed = f(3333333333, 10000000000);
    const stored = apportionStored([typed, typed, typed]);
    expect(stored).toEqual(["0.3333333333", "0.3333333333", "0.3333333333"]);
  });

  it("never rounds a sub-100% schedule up to a full grant", () => {
    // 0.99999999995 + 0.00000000001 = 0.99999999996, a shade under the whole
    // grant. Rounding the running total up would reach exactly 100% and vest a
    // share nobody scheduled, so every boundary is held one ulp below.
    const stored = apportionStored([
      f(99999999995, 100000000000),
      f(1, 100000000000),
    ]);
    expect(stored).toEqual(["0.9999999999", "0"]);
    // The cap applies to every boundary, not just the last: capping only the last
    // would leave the second statement holding a negative share.
    for (const s of stored)
      expect(numericToFraction(s).numerator).toBeGreaterThanOrEqual(0);
  });

  it("over-summing shares are stored as-is (the persist gate refuses, not this helper)", () => {
    // 0.6 + 0.6 over-allocates; apportionStored must not throw — it stores
    // faithfully, and the no-cap rule keeps it honest rather than reshaping it to
    // 100%.
    expect(apportionStored([f(3, 5), f(3, 5)])).toEqual(["0.6", "0.6"]);
  });

  it("keeps the boundaries non-decreasing, so no statement stores a negative share", () => {
    const sets: Fraction[][] = [
      [f(1, 3), f(1, 3), f(1, 3)],
      [f(19, 48), f(29, 48)],
      [f(1, 7), f(2, 7), f(4, 7)],
      [f(99999999995, 100000000000), f(1, 100000000000)],
      [f(1, 3), f(1, 4)],
      [f(3, 5), f(3, 5)],
    ];
    for (const set of sets) {
      for (const s of apportionStored(set)) {
        expect(numericToFraction(s).numerator).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("analyzePrecision — the boundary's own guard", () => {
  it("stays silent for a rounded-up third that lands the intended count", () => {
    const verdict = analyzePrecision(
      "0.3333333334",
      { numerator: 1, denominator: 3 },
      36000,
    );
    expect(verdict.kind).toBe("precise-enough");
  });

  it("raises no concern for a percentage that writes its fraction exactly", () => {
    expect(
      analyzePrecision("0.25", { numerator: 1, denominator: 4 }, 36000).kind,
    ).toBe("terminating");
  });
});
