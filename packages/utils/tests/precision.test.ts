import { describe, it, expect } from "vitest";
import type { Fraction } from "@vestlang/types";
import { analyzePrecision } from "../src/precision";
import { fractionToNumeric } from "../src/numeric";

const f = (numerator: number, denominator: number): Fraction => ({
  numerator,
  denominator,
});

// The decimal a fraction actually stores as, so the analyzer is fed the pair the
// engine really produces rather than a hand-typed decimal that drifts from it.
const stored = (numerator: number, denominator: number): string =>
  fractionToNumeric(f(numerator, denominator));

describe("analyzePrecision", () => {
  it("reports exact for a string with no decimal point", () => {
    expect(analyzePrecision("1", f(1, 1), 100)).toEqual({ kind: "exact" });
    expect(analyzePrecision("42", f(42, 1), 100)).toEqual({ kind: "exact" });
  });

  it("reports terminating when the decimal writes the fraction exactly", () => {
    expect(analyzePrecision("0.25", f(1, 4), 12345)).toEqual({
      kind: "terminating",
      fraction: f(1, 4),
    });
    expect(analyzePrecision("0.25", f(1, 4), 7n)).toEqual({
      kind: "terminating",
      fraction: f(1, 4),
    });
  });

  it("reduces the fraction it reports back", () => {
    // A cliff hands over its raw m/occurrences — 12 of 36 monthly occurrences —
    // and the reader wants to see 1/3.
    const v = analyzePrecision(stored(12, 36), f(12, 36), 36000);
    expect(v.kind).toBe("precise-enough");
    if (v.kind !== "exact") expect(v.fraction).toEqual(f(1, 3));
  });

  it("does not call a fraction terminating just because its decimal expansion ends", () => {
    // 1/2048 = 0.00048828125 terminates, and still needs eleven places — so the
    // stored value is NOT the fraction, and the verdict has to be decided by the
    // share counts rather than by the denominator's prime factors.
    const v = analyzePrecision(stored(1, 2048), f(1, 2048), 2048);
    expect(stored(1, 2048)).toBe("0.0004882813");
    expect(v.kind).toBe("precise-enough");
  });

  it("reports precise-enough when the stored decimal still lands the intended count", () => {
    // A third of 36,000 is exactly 12,000, and the rounded-up decimal lands it.
    const v = analyzePrecision(stored(1, 3), f(1, 3), 36000);
    expect(v).toEqual({ kind: "precise-enough", fraction: f(1, 3) });
  });

  it("reports rounds-high when the stored decimal pays over and a storable value would not", () => {
    // Ten billion shares on a 48-month grid with a 19-month cliff. The exact lump
    // is 3,958,333,333⅓ shares, the stored decimal pays 3,958,333,334 — a share
    // long, never short. "0.3958333333" would land it, but that value is only
    // right at THIS grant, so the engine can't store it.
    const v = analyzePrecision(stored(19, 48), f(19, 48), 10_000_000_000);
    expect(v).toEqual({
      kind: "rounds-high",
      fraction: f(19, 48),
      suppliedShares: 3958333334n,
      intendedShares: 3958333333n,
    });
  });

  it("reports not-representable with the closest value and signed offBy", () => {
    // At 30,000,000,001 shares the window around the intended count is narrower
    // than 10⁻¹⁰, so no storable decimal lands it — a genuine ceiling of the
    // interchange rather than a choice the engine made.
    const v = analyzePrecision(stored(1, 3), f(1, 3), 30000000001);
    expect(v).toEqual({
      kind: "not-representable",
      fraction: f(1, 3),
      suppliedShares: 10000000002n,
      intendedShares: 10000000000n,
      closest: "0.3333333333",
      offBy: -1n,
    });
  });

  it("stays exact for share counts past 2^53", () => {
    // The intermediate products here (M·10^10, j·N) run well past
    // MAX_SAFE_INTEGER; the verdict is still computed without drift.
    const v = analyzePrecision(stored(1, 3), f(1, 3), 30000000001n);
    expect(v.kind).toBe("not-representable");
    if (v.kind === "not-representable") {
      expect(v.fraction).toEqual(f(1, 3));
      expect(v.intendedShares).toBe(10000000000n);
      expect(v.offBy).toBe(-1n);
    }
  });

  describe("input guards", () => {
    it("throws on a non-positive share count", () => {
      expect(() => analyzePrecision("0.5", f(1, 2), 0)).toThrow(
        /positive integer/,
      );
      expect(() => analyzePrecision("0.5", f(1, 2), -10)).toThrow(
        /positive integer/,
      );
      expect(() => analyzePrecision("0.5", f(1, 2), 0n)).toThrow(
        /positive integer/,
      );
      expect(() => analyzePrecision("0.5", f(1, 2), -1n)).toThrow(
        /positive integer/,
      );
    });

    it("throws on a non-safe-integer number share count", () => {
      expect(() => analyzePrecision("0.5", f(1, 2), 1.5)).toThrow(
        /positive integer/,
      );
      expect(() =>
        analyzePrecision("0.5", f(1, 2), Number.MAX_SAFE_INTEGER + 2),
      ).toThrow(/positive integer/);
    });

    it("throws on a decimal that fails the OCF Numeric pattern", () => {
      expect(() => analyzePrecision("abc", f(1, 2), 100)).toThrow(
        /OCF Numeric/,
      );
      expect(() => analyzePrecision("0.5e3", f(1, 2), 100)).toThrow(
        /OCF Numeric/,
      );
      // More than ten fractional places is out of domain.
      expect(() => analyzePrecision("0.12345678901", f(1, 2), 100)).toThrow(
        /OCF Numeric/,
      );
      expect(() => analyzePrecision("", f(1, 2), 100)).toThrow(/OCF Numeric/);
    });

    it("throws on a negative decimal, including the -0 forms", () => {
      expect(() => analyzePrecision("-0.5", f(1, 2), 100)).toThrow(
        /non-negative/,
      );
      expect(() => analyzePrecision("-0", f(1, 2), 100)).toThrow(
        /non-negative/,
      );
      expect(() => analyzePrecision("-0.0", f(1, 2), 100)).toThrow(
        /non-negative/,
      );
    });

    it("throws on a non-positive or non-integer fraction part", () => {
      expect(() => analyzePrecision("0.5", f(0, 2), 100)).toThrow(/fraction/);
      expect(() => analyzePrecision("0.5", f(-1, 2), 100)).toThrow(/fraction/);
      expect(() => analyzePrecision("0.5", f(1, 0), 100)).toThrow(/fraction/);
      expect(() => analyzePrecision("0.5", f(1.5, 2), 100)).toThrow(/fraction/);
    });

    it("accepts a positive bigint share count", () => {
      expect(analyzePrecision("0.25", f(1, 4), 12345n)).toEqual({
        kind: "terminating",
        fraction: f(1, 4),
      });
    });
  });

  // The cliff precision guard calls the analyzer with N = grant and
  // basisScale = stmtFraction, so the single floor becomes
  // floor(decimal × stmtNum × grant / stmtDen) — the realizer's grant-scale leading
  // lump — instead of pre-flooring the statement's share count and flooring twice.
  describe("basisScale (the rational share basis)", () => {
    it("defaults to 1/1, and an explicit 1/1 matches the unscaled call", () => {
      const bare = analyzePrecision(stored(1, 3), f(1, 3), 36000);
      expect(analyzePrecision(stored(1, 3), f(1, 3), 36000, f(1, 1))).toEqual(
        bare,
      );
    });

    it("keeps a half-of-grant statement's lump exact at an odd grant", () => {
      // floor(0.5 × 72001) = 36000 would be a lossy basis to floor against a second
      // time. Against the single grant-scale floor the stored decimal and the exact
      // third agree on 12,000, so there is nothing to report.
      const v = analyzePrecision(stored(1, 3), f(1, 3), 72001, f(1, 2));
      expect(v).toEqual({ kind: "precise-enough", fraction: f(1, 3) });
    });

    it("scales the reported counts by the basis, not just the share total", () => {
      // Same 1/3 cliff, but half of a 60-billion-share grant: the intended lump is
      // 10^10, a third of 30 billion — not a third of 60 billion. A basis-blind
      // reading would report double.
      const v = analyzePrecision(stored(1, 3), f(1, 3), 60000000000, f(1, 2));
      expect(v.kind).toBe("not-representable");
      if (v.kind === "not-representable") {
        expect(v.intendedShares).toBe(10000000000n);
        expect(v.suppliedShares).toBe(10000000002n);
      }
    });

    it("throws on a non-positive or non-integer basis part", () => {
      expect(() => analyzePrecision("0.5", f(1, 2), 100, f(0, 2))).toThrow(
        /basisScale/,
      );
      expect(() => analyzePrecision("0.5", f(1, 2), 100, f(-1, 2))).toThrow(
        /basisScale/,
      );
      expect(() => analyzePrecision("0.5", f(1, 2), 100, f(1, 0))).toThrow(
        /basisScale/,
      );
      expect(() => analyzePrecision("0.5", f(1, 2), 100, f(1.5, 2))).toThrow(
        /basisScale/,
      );
    });
  });
});
