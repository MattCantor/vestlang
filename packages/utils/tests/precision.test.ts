import { describe, it, expect } from "vitest";
import { analyzePrecision } from "../src/precision";
import type { InferredFraction } from "../src/precision";

const frac = (numerator: bigint, denominator: bigint): InferredFraction => ({
  numerator,
  denominator,
});

describe("analyzePrecision", () => {
  // Criterion 1: the no-remainder ("rounded-up") branch. 0.3333 truncates 1/3
  // below the true value, so floor(0.3333·36000)=11998 under-allocates; 0.3334
  // overshoots to 12002. The shortest decimal that lands on 12000 is the
  // rounded-up 0.33334 at five places.
  it("misallocates and recommends a rounded-up value", () => {
    const v = analyzePrecision("0.3333", 36000);
    expect(v).toEqual({
      kind: "misallocates",
      inferred: frac(1n, 3n),
      suppliedShares: 11998n,
      intendedShares: 12000n,
      usePlaces: 5,
      recommended: "0.33334",
    });
  });

  // Criterion 2: the ordinary remainder branch lands on a plain truncation —
  // 0.33333 — contrasting with criterion 1's rounded-up result from the same
  // single window search.
  it("misallocates and recommends a plain truncation", () => {
    const v = analyzePrecision("0.33", 100000);
    expect(v).toEqual({
      kind: "misallocates",
      inferred: frac(1n, 3n),
      suppliedShares: 33000n,
      intendedShares: 33333n,
      usePlaces: 5,
      recommended: "0.33333",
    });
  });

  // Criterion 3: a terminating fraction is written exactly by its decimal, so no
  // warning regardless of share count.
  it("reports a terminating fraction with no warning", () => {
    expect(analyzePrecision("0.25", 12345)).toEqual({
      kind: "terminating",
      inferred: frac(1n, 4n),
    });
    expect(analyzePrecision("0.25", 7n)).toEqual({
      kind: "terminating",
      inferred: frac(1n, 4n),
    });
  });

  // Criterion 4: a repeating fraction that still allocates correctly at this
  // size. 0.33 and 1/3 both floor to 33 of 100. This proves the suppression is
  // the counts-equal gate, not the terminating gate (1/3 repeats).
  it("reports precise-enough when the truncation still lands right", () => {
    expect(analyzePrecision("0.33", 100)).toEqual({
      kind: "precise-enough",
      inferred: frac(1n, 3n),
    });
  });

  // Criterion 5: the false-alarm killer. The simplest fraction in [0.1429,
  // 0.1430) is the ugly 144/1007, well over the simplicity cap (1007² ≫ 10⁴), so
  // the decimal is read as meaning itself — no warning.
  it("reports too-complex when the inferred fraction is over the cap", () => {
    const v = analyzePrecision("0.1429", 100000);
    expect(v).toEqual({
      kind: "too-complex",
      inferred: frac(144n, 1007n),
    });
  });

  // Control for criterion 5: the cap is what suppresses the warning. The inferred
  // fraction really is 144/1007, and without the denominator-squared cap this
  // input would otherwise misallocate (floor(0.1429·100000)=14290 vs the
  // fraction's floor(144·100000/1007)=14299).
  it("would misallocate without the simplicity cap (control)", () => {
    const v = analyzePrecision("0.1429", 100000);
    expect(v.kind).toBe("too-complex");
    if (v.kind === "too-complex") {
      expect(v.inferred).toEqual(frac(144n, 1007n));
    }
    // Counts that the cap is suppressing: the supplied truncation lands on 14290,
    // the inferred fraction on 14299 — they differ, so only the cap stops a warning.
    const supplied = (1429n * 100000n) / 10000n;
    const intended = (144n * 100000n) / 1007n;
    expect(supplied).toBe(14290n);
    expect(intended).toBe(14299n);
    expect(supplied).not.toBe(intended);
  });

  // Criterion 6: cap-exceeded. With N just over 3e10 the correct window is
  // narrower than any 10-place decimal can hit, so no usePlaces exists. The
  // closest storable value is the supplied decimal itself, one share under.
  // (N is within Number.MAX_SAFE_INTEGER, so this also exercises the number arm.)
  it("reports not-representable with the closest value and signed offBy", () => {
    const v = analyzePrecision("0.3333333333", 30000000001);
    expect(v).toEqual({
      kind: "not-representable",
      inferred: frac(1n, 3n),
      suppliedShares: 9999999999n,
      intendedShares: 10000000000n,
      closest: "0.3333333333",
      offBy: -1n,
    });
  });

  // Criterion 7: the half-open interval. [0.49, 0.50) does NOT contain 1/2 (the
  // upper bound is excluded), so the simplest fraction is 25/51 — over the
  // 2-digit cap, hence too-complex. The closed-interval textbook routine would
  // wrongly answer 1/2 here.
  it("excludes the upper bound of the inference interval", () => {
    const v = analyzePrecision("0.49", 100000);
    expect(v).toEqual({
      kind: "too-complex",
      inferred: frac(25n, 51n),
    });
  });

  // Criterion 8: a real vesting denominator. 1/48 of a 48000-share grant should
  // be exactly 1000, but 0.0208 floors to 998; 0.02084 at five places fixes it.
  it("misallocates on a 1/48 vesting fraction", () => {
    const v = analyzePrecision("0.0208", 48000);
    expect(v).toEqual({
      kind: "misallocates",
      inferred: frac(1n, 48n),
      suppliedShares: 998n,
      intendedShares: 1000n,
      usePlaces: 5,
      recommended: "0.02084",
    });
  });

  // Criterion 9: an integer string has no fractional digits, so there is nothing
  // to infer.
  it("reports exact for a string with no decimal point", () => {
    expect(analyzePrecision("0", 100)).toEqual({ kind: "exact" });
    expect(analyzePrecision("1", 100)).toEqual({ kind: "exact" });
    expect(analyzePrecision("42", 100)).toEqual({ kind: "exact" });
  });

  // Criterion 10: input guards. Mirrors floorSharesAt — a non-positive or
  // non-safe-integer share count throws, as does an out-of-domain decimal.
  describe("input guards", () => {
    it("throws on a non-positive share count", () => {
      expect(() => analyzePrecision("0.5", 0)).toThrow(/positive integer/);
      expect(() => analyzePrecision("0.5", -10)).toThrow(/positive integer/);
      expect(() => analyzePrecision("0.5", 0n)).toThrow(/positive integer/);
      expect(() => analyzePrecision("0.5", -1n)).toThrow(/positive integer/);
    });

    it("throws on a non-safe-integer number share count", () => {
      expect(() => analyzePrecision("0.5", 1.5)).toThrow(/positive integer/);
      expect(() =>
        analyzePrecision("0.5", Number.MAX_SAFE_INTEGER + 2),
      ).toThrow(/positive integer/);
    });

    it("throws on a decimal that fails the OCF Numeric pattern", () => {
      expect(() => analyzePrecision("abc", 100)).toThrow(/OCF Numeric/);
      expect(() => analyzePrecision("0.5e3", 100)).toThrow(/OCF Numeric/);
      // More than ten fractional places is out of domain.
      expect(() => analyzePrecision("0.12345678901", 100)).toThrow(
        /OCF Numeric/,
      );
      expect(() => analyzePrecision("", 100)).toThrow(/OCF Numeric/);
    });

    it("throws on a negative decimal, including the -0 forms", () => {
      expect(() => analyzePrecision("-0.5", 100)).toThrow(/non-negative/);
      expect(() => analyzePrecision("-0", 100)).toThrow(/non-negative/);
      expect(() => analyzePrecision("-0.0", 100)).toThrow(/non-negative/);
    });

    it("accepts a positive bigint share count", () => {
      expect(analyzePrecision("0.25", 12345n)).toEqual({
        kind: "terminating",
        inferred: frac(1n, 4n),
      });
    });
  });

  // Criterion 11: float-free at scale. The inference returns the correct reduced
  // fraction at share counts past 2^53, where number math would drift. The
  // intermediate products here (M·10^10, j·N) run well past MAX_SAFE_INTEGER yet
  // the verdict is exact — exercised end to end by criterion 6 and pinned again
  // on the bigint arm.
  it("stays exact for share counts past 2^53", () => {
    const v = analyzePrecision("0.3333333333", 30000000001n);
    expect(v.kind).toBe("not-representable");
    if (v.kind === "not-representable") {
      expect(v.inferred).toEqual(frac(1n, 3n));
      expect(v.intendedShares).toBe(10000000000n);
      expect(v.offBy).toBe(-1n);
    }
  });

  // The string format: leading "0.", exactly the chosen number of places, built
  // from the integer numerator (no float division), so a trailing digit like the
  // 4 in 0.33334 survives and there is no float rounding.
  it("formats the recommended decimal exactly", () => {
    const a = analyzePrecision("0.3333", 36000);
    if (a.kind === "misallocates") expect(a.recommended).toBe("0.33334");
    const b = analyzePrecision("0.0208", 48000);
    if (b.kind === "misallocates") expect(b.recommended).toBe("0.02084");
  });

  // #386 — the optional basisScale. The cliff precision guard calls the analyzer
  // with N = grant and basisScale = stmtFraction, so the analyzer's single floor
  // becomes floor(decimal × stmtNum × grant / stmtDen) — the realizer's grant-scale
  // leading lump — instead of pre-flooring the statement share count.
  describe("basisScale (the rational share basis)", () => {
    // A number-based Fraction (the public `@vestlang/types` shape the analyzer's
    // basisScale param takes), distinct from the BigInt `frac` used for `inferred`.
    const bf = (numerator: number, denominator: number) => ({
      numerator,
      denominator,
    });

    // The default and an explicit 1/1 are byte-identical to the no-basis path.
    it("defaults to 1/1 and an explicit 1/1 matches the unscaled call", () => {
      const bare = analyzePrecision("0.3333", 36000);
      expect(analyzePrecision("0.3333", 36000, bf(1, 1))).toEqual(bare);
    });

    // The AC7a false positive: at basisScale 1/2 and N = 72001 the single floor is
    // floor(1/3 × 1/2 × 72001) for both the supplied decimal and the intended
    // fraction — 12000 == 12000 — so the verdict is precise-enough, NOT a warning.
    // The old pre-floored basis (floor(1/2 × 72001) = 36000) double-floored to
    // 11999 and would have misallocated.
    it("kills the AC7a false positive at a lossy basis (1/3 cliff, 1/2 stmt, N 72001)", () => {
      const v = analyzePrecision("0.3333333333", 72001, bf(1, 2));
      expect(v.kind).toBe("precise-enough");
      if (v.kind === "precise-enough") {
        expect(v.inferred).toEqual(frac(1n, 3n));
      }
    });

    // The AC7b false negative: realized lump floor(2/3-dec × 1/2 × 1005) = 334, but
    // the exact-fraction ideal floor(2/3 × 1/2 × 1005) = 335 — they differ, so the
    // verdict misallocates where the pre-floored basis (floor(1/2 × 1005) = 502,
    // floor(2/3 × 502) = 334 = the realized lump) stayed silent.
    it("catches the AC7b false negative at a lossy basis (2/3 cliff, 1/2 stmt, N 1005)", () => {
      const v = analyzePrecision("0.6666666666", 1005, bf(1, 2));
      expect(v.kind).toBe("misallocates");
      if (v.kind === "misallocates") {
        expect(v.suppliedShares).toBe(334n);
        expect(v.intendedShares).toBe(335n);
        expect(v.inferred).toEqual(frac(2n, 3n));
      }
    });

    // The reported `inferred` reads the decimal alone, so the basis scale doesn't
    // move it; and the recommended window search runs against the same rational
    // basis. The AC1 case (1/3 cliff, 1/2 stmt, N 72000) still recommends 0.33334.
    it("recommends against the scaled basis (AC1: 0.33334 at 1/2 of 72000)", () => {
      const v = analyzePrecision("0.3333333333", 72000, bf(1, 2));
      expect(v.kind).toBe("misallocates");
      if (v.kind === "misallocates") {
        expect(v.intendedShares).toBe(12000n);
        expect(v.recommended).toBe("0.33334");
      }
    });

    // The precondition: a non-positive or non-integer basis numerator/denominator
    // throws, mirroring the shareCount guard. A zero numerator means the basis
    // covers no shares — the caller skips it, it never reaches the analyzer.
    it("throws on a non-positive or non-integer basis part", () => {
      expect(() => analyzePrecision("0.5", 100, bf(0, 2))).toThrow(
        /basisScale/,
      );
      expect(() => analyzePrecision("0.5", 100, bf(-1, 2))).toThrow(
        /basisScale/,
      );
      expect(() => analyzePrecision("0.5", 100, bf(1, 0))).toThrow(
        /basisScale/,
      );
      expect(() => analyzePrecision("0.5", 100, bf(1.5, 2))).toThrow(
        /basisScale/,
      );
    });
  });
});
