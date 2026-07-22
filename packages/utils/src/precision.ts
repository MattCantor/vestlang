// Precision analyzer for a percentage written as a fixed-point decimal.
//
// A vesting percentage is stored as an OCF `Numeric` (≤10 places) rather than an
// exact fraction, so a share like 1/3 can only be written to the nearest point on
// the ten-place grid — `0.3333333334`. Allocated under the engine's
// floor-of-product share math, a stored value can still land on a different
// whole-share count than the fraction it was written from: floor(0.3333333334 ×
// 3·10^10) is two shares over true 1/3. This module is the guardrail. Given the
// decimal, the exact fraction it was written from, and the share basis, it says
// whether the two allocate to the same count and, when they don't, whether ten
// places could have landed it at all.
//
// It is *handed* the fraction rather than guessing one. An earlier version
// searched for "the simplest fraction that truncates to these digits", which was
// a guess even while the write direction was truncation and is wrong now that it
// isn't. Every decimal reaching this analyzer was rendered from a fraction the
// caller still holds, so the guess buys nothing.
//
// Everything on the value path runs in BigInt. Share counts reach ~3e10 and the
// products run larger still, well past the range where `number` rounds.
//
// The OCF grammar and its parse/render primitives live in `numeric.ts` (the one
// home for what a Numeric is); this file imports them.

import type { Fraction } from "@vestlang/types";
import { parseDecimal, renderFixed } from "./numeric.js";

/**
 * The analyzer's verdict — a tagged union so each outcome names itself rather
 * than collapsing to a yes/no warning.
 *
 *   exact              No fractional digits; nothing to compare.
 *   terminating        The decimal writes the fraction exactly.
 *   precise-enough     The decimal isn't the fraction, but still allocates to the
 *                      same whole-share count at this basis.
 *   rounds-high        The decimal allocates ABOVE the fraction, and some ten-place
 *                      decimal would have landed it. Not an actionable report: the
 *                      value that lands it depends on the grant, and a stored
 *                      percentage has to work at every grant.
 *   not-representable  No ≤10-place decimal lands the intended count, at any
 *                      rounding; `closest` is the nearest storable value and
 *                      `offBy` how many shares it misses by.
 */
export type PrecisionVerdict =
  | { kind: "exact" }
  | { kind: "terminating"; fraction: Fraction }
  | { kind: "precise-enough"; fraction: Fraction }
  | {
      kind: "rounds-high";
      fraction: Fraction;
      suppliedShares: bigint;
      intendedShares: bigint;
    }
  | {
      kind: "not-representable";
      fraction: Fraction;
      suppliedShares: bigint;
      intendedShares: bigint;
      closest: string;
      offBy: bigint;
    };

// The OCF ceiling (the grammar's max fractional digits), which is also the grid
// every stored percentage sits on.
const MAX_PLACES = 10n;
const GRID = 10n ** MAX_PLACES;

const abs = (v: bigint): bigint => (v < 0n ? -v : v);

const gcd = (a: bigint, b: bigint): bigint => {
  let x = abs(a);
  let y = abs(b);
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x || 1n;
};

const RANGE_ERROR = "analyzePrecision: shareCount must be a positive integer";
const FRACTION_ERROR =
  "analyzePrecision: fraction numerator and denominator must be positive integers";
const BASIS_ERROR =
  "analyzePrecision: basisScale numerator and denominator must be positive integers";

// shareCount mirrors allocate.ts's floorSharesAt guard: a `number` must be a
// safe integer (Number.isInteger would admit 2^53 + 2, which the BigInt cast
// then can't represent exactly) and strictly positive; a `bigint` must be > 0n.
const toShareCount = (shareCount: number | bigint): bigint => {
  if (typeof shareCount === "bigint") {
    if (shareCount <= 0n) {
      throw new Error(`${RANGE_ERROR} (got ${shareCount})`);
    }
    return shareCount;
  }
  if (!Number.isSafeInteger(shareCount) || shareCount <= 0) {
    throw new Error(`${RANGE_ERROR} (got ${shareCount})`);
  }
  return BigInt(shareCount);
};

const toPositivePair = (
  f: Fraction,
  message: string,
): { num: bigint; den: bigint } => {
  const { numerator, denominator } = f;
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    numerator <= 0 ||
    denominator <= 0
  ) {
    throw new Error(`${message} (got ${numerator}/${denominator})`);
  }
  return { num: BigInt(numerator), den: BigInt(denominator) };
};

// The optional basis scale. Default 1/1 leaves the plain floor(x · N) reading. A
// zero numerator means the basis covers no shares and must be skipped at the
// caller, never reach the analyzer.
const toBasisScale = (
  basisScale: Fraction | undefined,
): { bnum: bigint; bden: bigint } => {
  if (basisScale === undefined) return { bnum: 1n, bden: 1n };
  const { num, den } = toPositivePair(basisScale, BASIS_ERROR);
  return { bnum: num, bden: den };
};

/**
 * Analyze a stored percentage decimal against the exact fraction it was written
 * from and a share count: do the two allocate to the same whole-share count, and
 * if not, could any storable decimal have done better? See {@link
 * PrecisionVerdict} for the outcomes.
 *
 * @param decimal     A non-negative OCF `Numeric` string (≤10 decimal places).
 * @param fraction    The exact fraction `decimal` was rendered from. Reported back
 *                    reduced, so a cliff's raw `m/occurrences` reads as `1/3`.
 * @param shareCount  A positive integer (number must be a safe integer).
 * @param basisScale  Optional exact `Fraction` the share basis is scaled by before
 *                    the analyzer's own floor — `floor(x · basisScale · N)` rather
 *                    than `floor(x · N)`. Defaults to 1/1 (no scaling). A cliff
 *                    guard passes `N = grant` and `basisScale = stmtFraction` so the
 *                    one floor reproduces the realizer's grant-scale leading lump
 *                    `floor(stmtFraction · decimal · grant)` instead of double-flooring
 *                    a pre-floored per-statement count.
 * @throws if `decimal` is out of domain, `shareCount` is not a positive integer, or
 *         `fraction` / `basisScale` has a non-positive part.
 */
export const analyzePrecision = (
  decimal: string,
  fraction: Fraction,
  shareCount: number | bigint,
  basisScale?: Fraction,
): PrecisionVerdict => {
  const n = toShareCount(shareCount);
  const { num: rawP, den: rawQ } = toPositivePair(fraction, FRACTION_ERROR);
  const { bnum, bden } = toBasisScale(basisScale);
  // The shared grammar admits a leading sign, but a vesting percentage can't be
  // negative — reject any explicit minus (including the "-0" forms) so the
  // analyzer's share math never sees a negative supplied value.
  if (decimal.startsWith("-")) {
    throw new Error(
      `analyzePrecision: decimal must be non-negative (got ${decimal})`,
    );
  }
  const { places, scaledValue, scale } = parseDecimal(decimal);

  // No fractional digits: an integer percentage writes itself, whatever it was
  // rendered from.
  if (places === 0) {
    return { kind: "exact" };
  }

  const g = gcd(rawP, rawQ);
  const p = rawP / g;
  const q = rawQ / g;
  const reduced: Fraction = { numerator: Number(p), denominator: Number(q) };

  // The decimal IS the fraction — nothing can go wrong at any share count. Tested
  // against the value rather than the denominator's prime factors: 1/2048
  // terminates as a decimal and still needs eleven places, so it lands below, not
  // here.
  if (scaledValue * q === p * scale) {
    return { kind: "terminating", fraction: reduced };
  }

  // The two whole-share counts: what the written decimal allocates, and what the
  // exact fraction would — each one exact floor of a product, scaled by the basis
  // (default 1/1). At basisScale = stmtFraction and N = grant these are the
  // realizer's grant-scale leading lump and its exact-fraction ideal.
  const suppliedShares = (scaledValue * bnum * n) / (scale * bden);
  const intendedShares = (p * bnum * n) / (q * bden);
  if (suppliedShares === intendedShares) {
    return { kind: "precise-enough", fraction: reduced };
  }

  // Only one direction can reach here: the render rounds up, so the stored decimal
  // is ≥ the fraction and its floor can only be ≥ the fraction's. The question is
  // therefore never "is it short" but "could ten places have landed it at all".
  //
  // Writing B = bnum·N and D = bden, a decimal x lands the intended count M iff
  // M ≤ x·B/D < M+1. The smallest ten-place x at or above that lower bound has
  // numerator ceil(M·10^10·D / B), and it lands iff numerator·B < (M+1)·10^10·D.
  const basisProduct = bnum * n; // B
  const lowest =
    (intendedShares * GRID * bden + basisProduct - 1n) / basisProduct;
  if (lowest * basisProduct < (intendedShares + 1n) * GRID * bden) {
    // Some storable decimal lands the count — but which one depends on this grant,
    // and a stored percentage has to be right at every grant, so the engine can't
    // spend it. Report the overshoot; the caller decides whether it is worth a word.
    return {
      kind: "rounds-high",
      fraction: reduced,
      suppliedShares,
      intendedShares,
    };
  }

  // The landing window is narrower than 10⁻¹⁰ — no storable decimal hits it, which
  // only happens at very large share counts. Report the closest storable value
  // instead: among all 10-place decimals, the one minimizing the share miss
  // |floor(x · basisScale · N) − intendedShares|, ties going to the lower value
  // (prefer under-allocation). The miss is monotone around the target, so the
  // winner sits within a couple of grid steps of it.
  const center = (intendedShares * GRID * bden) / basisProduct; // floor(M·10^10·D / B)
  let best: { numerator: bigint; offBy: bigint } | null = null;
  for (let j = center - 3n; j <= center + 3n; j++) {
    if (j < 0n || j >= GRID) continue;
    const offBy = (j * basisProduct) / (GRID * bden) - intendedShares;
    const distance = abs(offBy);
    if (
      best === null ||
      distance < abs(best.offBy) ||
      (distance === abs(best.offBy) && j < best.numerator)
    ) {
      best = { numerator: j, offBy };
    }
  }
  // The neighborhood always contains a valid grid point (center itself qualifies
  // unless N=1, which never reaches here — a 1-place decimal would have fit).
  if (best === null) {
    throw new Error(
      "analyzePrecision: no representable decimal found (unreachable)",
    );
  }
  return {
    kind: "not-representable",
    fraction: reduced,
    suppliedShares,
    intendedShares,
    closest: renderFixed(best.numerator, Number(MAX_PLACES)),
    offBy: best.offBy,
  };
};
