// Exact-rational arithmetic over the canonical `Fraction`.
//
// Core computes shares-of-grant in exact rational so a schedule telescopes to
// the total without float drift; these helpers keep fractions reduced as they
// combine.
//
// The Fraction shape is Number-based, but at extreme grant sizes the numerator
// and denominator products run past 2^53 — where Number silently rounds, a
// numerator can drift and a whole share can vanish or double. So the arithmetic
// happens in BigInt: every product, sum, and comparison is exact, the result is
// reduced while still a BigInt, and only then converted back. If a reduced
// component still won't fit a safe integer we throw rather than hand back a
// rounded fraction that lies about what it carries.

import type { Fraction } from "@vestlang/types";

const bigGcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x || 1n;
};

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

// Reduce a BigInt numerator/denominator and convert back to a Number Fraction.
// A component that survives reduction but still exceeds Number.MAX_SAFE_INTEGER
// can't be represented exactly — refuse it loudly instead of letting the Number
// cast round it. The denominator carries the operands' context for the message.
const toFraction = (numerator: bigint, denominator: bigint): Fraction => {
  const d = bigGcd(numerator, denominator);
  const n = numerator / d;
  const den = denominator / d;
  const overflows = (v: bigint): boolean => (v < 0n ? -v : v) > MAX_SAFE;
  if (overflows(n) || overflows(den)) {
    throw new Error(
      `fraction component exceeds Number.MAX_SAFE_INTEGER after reduction ` +
        `(${n}/${den}); the grant or schedule is too large to allocate exactly`,
    );
  }
  return { numerator: Number(n), denominator: Number(den) };
};

export const fracReduce = (f: Fraction): Fraction =>
  toFraction(BigInt(f.numerator), BigInt(f.denominator));

export const fracMul = (a: Fraction, b: Fraction): Fraction =>
  toFraction(
    BigInt(a.numerator) * BigInt(b.numerator),
    BigInt(a.denominator) * BigInt(b.denominator),
  );

export const fracAdd = (a: Fraction, b: Fraction): Fraction =>
  toFraction(
    BigInt(a.numerator) * BigInt(b.denominator) +
      BigInt(b.numerator) * BigInt(a.denominator),
    BigInt(a.denominator) * BigInt(b.denominator),
  );

export const fracSub = (a: Fraction, b: Fraction): Fraction =>
  toFraction(
    BigInt(a.numerator) * BigInt(b.denominator) -
      BigInt(b.numerator) * BigInt(a.denominator),
    BigInt(a.denominator) * BigInt(b.denominator),
  );

export const ZERO: Fraction = { numerator: 0, denominator: 1 };
export const ONE: Fraction = { numerator: 1, denominator: 1 };

// A BigInt-backed exact rational. The kernel's internal share math multiplies a
// statement's share of the grant by its cliff percentage, and when both are
// non-terminating 10-place truncations the product's components run past 2^53 —
// exactly where the Number-backed `Fraction` (its guard `toFraction`) has to
// refuse them. So the kernel carries its fractionOfGrant and its running
// cumulative as `BigRational` end to end and only narrows to a share count at the
// integer floor, never back to a Number `Fraction`. Kept reduced after every
// operation so operands can't grow unbounded across a long cumulative chain.
// Denominators here are always positive (every operand widens from a validated
// positive-denominator Fraction, and product/sum of positives stays positive).
export interface BigRational {
  numerator: bigint;
  denominator: bigint;
}

export const bigReduce = (
  numerator: bigint,
  denominator: bigint,
): BigRational => {
  const g = bigGcd(numerator, denominator);
  return { numerator: numerator / g, denominator: denominator / g };
};

export const toBigRational = (f: Fraction): BigRational => ({
  numerator: BigInt(f.numerator),
  denominator: BigInt(f.denominator),
});

export const BIG_ZERO: BigRational = { numerator: 0n, denominator: 1n };
export const BIG_ONE: BigRational = { numerator: 1n, denominator: 1n };

export const bigMul = (a: BigRational, b: BigRational): BigRational =>
  bigReduce(a.numerator * b.numerator, a.denominator * b.denominator);

export const bigAdd = (a: BigRational, b: BigRational): BigRational =>
  bigReduce(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );

export const bigSub = (a: BigRational, b: BigRational): BigRational =>
  bigReduce(
    a.numerator * b.denominator - b.numerator * a.denominator,
    a.denominator * b.denominator,
  );

/** Sum a list of fractions (empty list → 0). */
export const fracSum = (fs: Fraction[]): Fraction => fs.reduce(fracAdd, ZERO);

// Compare two fractions without dividing: a/b vs c/d has the same ordering as
// a·d vs c·b, since every denominator in play here is positive. The cross
// products run in BigInt so the comparison stays exact at any grant size.
// Returns -1, 0, or 1 — the usual comparator sign — so callers can ask
// `fracCmp(x, ONE) > 0` etc.
export const fracCmp = (a: Fraction, b: Fraction): -1 | 0 | 1 => {
  const lhs = BigInt(a.numerator) * BigInt(b.denominator);
  const rhs = BigInt(b.numerator) * BigInt(a.denominator);
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
};

// Where an allocation total sits relative to the whole grant: over the whole is
// "over", short of it "under", on the nose "exact". The over=error / under=warning
// severity policy is the caller's to apply; this just names the three cases so the
// linter rule and the evaluator's findings classify them the same way.
export const classifyAllocation = (
  sum: Fraction,
): "over" | "under" | "exact" => {
  const cmp = fracCmp(sum, ONE);
  return cmp > 0 ? "over" : cmp < 0 ? "under" : "exact";
};

// A fraction as a rounded percent, e.g. 3/2 → "150%". The exact fraction stays the
// source of truth; this is purely for human-facing messages.
export const formatPct = (f: Fraction): string =>
  `${Math.round((f.numerator / f.denominator) * 100)}%`;
