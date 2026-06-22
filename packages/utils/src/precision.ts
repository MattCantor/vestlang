// Precision analyzer for a percentage written as a fixed-point decimal.
//
// When a vesting percentage is stored as a decimal string (an OCF `Numeric`,
// ≤10 places) rather than an exact fraction, a repeating fraction like 1/3 can
// only be written truncated — `0.3333`. Allocated under the engine's
// floor-of-product share math, an under-precise decimal can land on the wrong
// whole-share count: floor(0.3333 × 36000) = 11,998, where true 1/3 gives
// 12,000. This module is the guardrail. Given the (decimal, shareCount) pair it
//
//   1. infers the simplest fraction the author plausibly meant,
//   2. decides whether the written decimal still allocates to the same count,
//   3. and, when it doesn't, recommends the shortest decimal that does.
//
// "Infer", not "recover": once the rational is dropped at the storage boundary
// the intent is genuinely ambiguous — infinitely many fractions truncate to the
// same digits — so the result is a best guess under a stated assumption, not a
// recovered fact.
//
// Everything on the value path runs in BigInt. Share counts reach ~3e10 and the
// continued-fraction intermediates run larger still, well past the range where
// `number` rounds; the analyzer's own `bigint` arithmetic below keeps it exact.
// (It deliberately does not route through `fractions.ts`, whose helpers convert
// back to a `number`-based Fraction and throw past MAX_SAFE_INTEGER.)

/** A reduced fraction carried in BigInt so large denominators stay exact. */
export interface InferredFraction {
  numerator: bigint;
  denominator: bigint;
}

/**
 * The analyzer's verdict — a tagged union so each outcome names itself rather
 * than collapsing to a yes/no warning.
 *
 *   exact             No fractional digits; nothing to infer.
 *   too-complex       Simplest inferred fraction is uglier than the digits
 *                     justify, so the decimal is taken to mean itself.
 *   terminating       Inferred fraction terminates; the decimal is exact.
 *   precise-enough    Fraction repeats, but the written decimal still allocates
 *                     to the intended count at this share size.
 *   misallocates      The written decimal lands on the wrong count; `recommended`
 *                     is the shortest decimal that lands on the right one.
 *   not-representable  No ≤10-place decimal lands on the right count (only for
 *                     very large share counts); `closest` is the nearest storable
 *                     value and `offBy` how many shares it misses by.
 */
export type PrecisionVerdict =
  | { kind: "exact" }
  | { kind: "too-complex"; inferred: InferredFraction }
  | { kind: "terminating"; inferred: InferredFraction }
  | { kind: "precise-enough"; inferred: InferredFraction }
  | {
      kind: "misallocates";
      inferred: InferredFraction;
      suppliedShares: bigint;
      intendedShares: bigint;
      usePlaces: number;
      recommended: string;
    }
  | {
      kind: "not-representable";
      inferred: InferredFraction;
      suppliedShares: bigint;
      intendedShares: bigint;
      closest: string;
      offBy: bigint;
    };

// The OCF `Numeric` shape this analyzer accepts: an optional sign, integer part,
// and up to ten fractional digits. No scientific notation. The 10-place ceiling
// is what makes the not-representable verdict reachable at all.
const NUMERIC_PATTERN = /^[+-]?[0-9]+(\.[0-9]{1,10})?$/;

// Most fractional decimals only matter up to ten places; tie this to the OCF
// ceiling so the window search and the closest-value search share one bound.
const MAX_PLACES = 10n;

const abs = (v: bigint): bigint => (v < 0n ? -v : v);

const gcd = (a: bigint, b: bigint): bigint => {
  let x = abs(a);
  let y = abs(b);
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x || 1n;
};

const reduce = (n: bigint, d: bigint): InferredFraction => {
  const g = gcd(n, d);
  return { numerator: n / g, denominator: d / g };
};

// Floor of a/b for a positive divisor b (BigInt `/` truncates toward zero, so a
// negative numerator needs a nudge). Used to peel the integer part off the
// continued fraction.
const floorDiv = (a: bigint, b: bigint): bigint => {
  const q = a / b;
  return a % b !== 0n && a < 0n ? q - 1n : q;
};

// Simplest rational strictly inside the OPEN interval (loN/loD, hiN/hiD), with
// lo < hi and everything positive. This is the textbook continued-fraction /
// Stern–Brocot descent: take the smallest integer that fits; otherwise peel off
// floor(lo), invert the interval, and recurse. The result is the unique rational
// with the smallest denominator between the two bounds.
const simplestInOpen = (
  loN: bigint,
  loD: bigint,
  hiN: bigint,
  hiD: bigint,
): InferredFraction => {
  const f = floorDiv(loN, loD);
  // An integer in the interval is as simple as it gets; the smallest candidate
  // is floor(lo)+1, and it qualifies only if it stays below hi.
  const intCandidate = f + 1n;
  if (intCandidate * hiD < hiN) {
    return { numerator: intCandidate, denominator: 1n };
  }
  // No integer fits: write x = f + 1/y. Subtracting f shifts the interval into
  // [0,1); inverting it (reciprocal) flips the bounds, and the simplest y there
  // gives the simplest x back.
  const loShifted = loN - f * loD;
  const hiShifted = hiN - f * hiD;
  const y = simplestInOpen(hiD, hiShifted, loD, loShifted);
  return {
    numerator: f * y.numerator + y.denominator,
    denominator: y.numerator,
  };
};

// Simplest rational in the HALF-OPEN interval [lo, hi): the left endpoint is a
// candidate, the right one is excluded. (The supplied decimal is read as a
// round-down truncation of intent, so the true value sits in [supplied,
// supplied + 1 ulp) — the upper bound must stay open. The closed-interval
// textbook routine would answer 1/2 for "0.49"; half-open gives 25/51.)
//
// lo is always inside the interval, so the answer is whichever has the smaller
// denominator: lo itself or the simplest value strictly between the bounds. On a
// denominator tie, lo wins (it is the lower value).
const simplestInHalfOpen = (
  loN: bigint,
  loD: bigint,
  hiN: bigint,
  hiD: bigint,
): InferredFraction => {
  const left = reduce(loN, loD);
  const inner = simplestInOpen(loN, loD, hiN, hiD);
  return inner.denominator < left.denominator ? inner : left;
};

// A reduced fraction terminates as a decimal iff its denominator's only prime
// factors are 2 and 5. Strip both and check what's left.
const terminates = (denominator: bigint): boolean => {
  let d = denominator;
  while (d % 2n === 0n) d /= 2n;
  while (d % 5n === 0n) d /= 5n;
  return d === 1n;
};

// Render an integer numerator over 10^places as a fixed-point decimal string:
// leading "0." for sub-1 values, exactly `places` fractional digits. Built from
// the integer alone — no float division — so it stays exact.
const renderFixed = (numerator: bigint, places: number): string => {
  const padded = numerator.toString().padStart(places + 1, "0");
  const cut = padded.length - places;
  return `${padded.slice(0, cut)}.${padded.slice(cut)}`;
};

const RANGE_ERROR = "analyzePrecision: shareCount must be a positive integer";

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

interface ParsedDecimal {
  places: number;
  // The decimal as an exact fraction: scaledValue / 10^places.
  scaledValue: bigint;
  scale: bigint;
}

const parseDecimal = (decimal: string): ParsedDecimal => {
  if (!NUMERIC_PATTERN.test(decimal)) {
    throw new Error(
      `analyzePrecision: decimal must be an OCF Numeric string (got ${JSON.stringify(decimal)})`,
    );
  }
  // The pattern admits a leading sign; a vesting percentage can't be negative.
  // Reject any explicit minus — including the "-0" forms — so the sign rule has
  // no special case for zero.
  if (decimal.startsWith("-")) {
    throw new Error(
      `analyzePrecision: decimal must be non-negative (got ${decimal})`,
    );
  }
  const unsigned = decimal.replace(/^[+-]/, "");
  const [intPart, fracPart = ""] = unsigned.split(".");
  const places = fracPart.length;
  const scaledValue = BigInt(intPart + fracPart);
  const scale = 10n ** BigInt(places);
  return { places, scaledValue, scale };
};

/**
 * Analyze a percentage decimal against a share count: infer the likely intended
 * fraction and report whether the written decimal still allocates to the right
 * whole-share count. See {@link PrecisionVerdict} for the outcomes.
 *
 * @param decimal     A non-negative OCF `Numeric` string (≤10 decimal places).
 * @param shareCount  A positive integer (number must be a safe integer).
 * @throws if `decimal` is out of domain or `shareCount` is not a positive integer.
 */
export const analyzePrecision = (
  decimal: string,
  shareCount: number | bigint,
): PrecisionVerdict => {
  const n = toShareCount(shareCount);
  const { places, scaledValue, scale } = parseDecimal(decimal);

  // No fractional digits: there is no truncation to second-guess.
  if (places === 0) {
    return { kind: "exact" };
  }

  // Recover the simplest fraction in [supplied, supplied + 1 ulp).
  const inferred = simplestInHalfOpen(
    scaledValue,
    scale,
    scaledValue + 1n,
    scale,
  );
  const { numerator: p, denominator: q } = inferred;

  // Simplicity cap (the false-alarm guard). Only believe the inferred fraction
  // when the digits typed actually justify its denominator: accept iff
  // denominator² ≤ 10^places (~twice as many digits as the denominator's size).
  // 1/3 from "0.3333" passes (3² ≤ 10⁴); the ugly 144/1007 from "0.1429" does
  // not, so that decimal is read as meaning itself.
  if (q * q > scale) {
    return { kind: "too-complex", inferred };
  }

  // A terminating fraction is written exactly by its decimal; no warning.
  if (terminates(q)) {
    return { kind: "terminating", inferred };
  }

  // The two whole-share counts: what the written decimal allocates, and what the
  // inferred fraction would. Both are exact floors of a product.
  const suppliedShares = (scaledValue * n) / scale;
  const intendedShares = (p * n) / q;
  if (suppliedShares === intendedShares) {
    return { kind: "precise-enough", inferred };
  }

  // Window search: find the shortest k-place decimal x with floor(x·N) ==
  // intendedShares, i.e. x ∈ [intendedShares/N, (intendedShares+1)/N). The
  // smallest k-place decimal ≥ the lower bound is ceil(intendedShares·10^k / N)
  // over 10^k; it fits iff it stays below the upper bound. First k wins.
  for (let k = 1n; k <= MAX_PLACES; k++) {
    const kScale = 10n ** k;
    const numerator = (intendedShares * kScale + n - 1n) / n; // ceil(M·10^k / N)
    if (numerator * n < (intendedShares + 1n) * kScale) {
      return {
        kind: "misallocates",
        inferred,
        suppliedShares,
        intendedShares,
        usePlaces: Number(k),
        recommended: renderFixed(numerator, Number(k)),
      };
    }
  }

  // No ≤10-place decimal lands in the window — it is narrower than 10⁻¹⁰, which
  // only happens at very large share counts. Report the closest storable value
  // instead: among all 10-place decimals, the one minimizing the share miss
  // |floor(x·N) − intendedShares|, ties going to the lower value (prefer
  // under-allocation). The miss is monotone around intendedShares/N, so the
  // winner sits within a couple of grid steps of that point.
  const grid = 10n ** MAX_PLACES;
  const center = (intendedShares * grid) / n; // floor(M·10^10 / N)
  let best: { numerator: bigint; offBy: bigint } | null = null;
  for (let j = center - 3n; j <= center + 3n; j++) {
    if (j < 0n || j >= grid) continue;
    const offBy = (j * n) / grid - intendedShares;
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
    inferred,
    suppliedShares,
    intendedShares,
    closest: renderFixed(best.numerator, Number(MAX_PLACES)),
    offBy: best.offBy,
  };
};
