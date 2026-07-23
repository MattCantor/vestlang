// Exact-rational arithmetic for the canonical `Fraction`.
//
// Core computes shares-of-grant in exact rational so a schedule telescopes to the
// total without float drift. All the arithmetic lives in one place: the BigInt
// `BigRational` family below (`bigMul`/`bigAdd`/`bigSub`/`bigCmp`, reduced after
// every step). The Number-backed `Fraction` ops are that same arithmetic with a
// narrowing tail — run it in BigInt, then `narrow` the result back to a Fraction.
//
// Narrowing is where the danger sits, so it happens in exactly one place. At
// extreme grant sizes a numerator or denominator runs past 2^53, where a Number
// silently rounds and a whole share can vanish or double. `narrow` refuses such a
// value loudly rather than hand back a rounded fraction that lies about what it
// carries. The BigInt family never narrows: the kernel and allocator carry a
// `BigRational` end to end and only collapse to an integer at the share floor,
// the one legitimate place an exact rational becomes a Number.

import type { Fraction } from "@vestlang/types";

const bigGcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x || 1n;
};

// A BigInt-backed exact rational. The kernel's internal share math multiplies a
// statement's share of the grant by its cliff percentage, and when both sit on
// the 10-place grid the product's components run past 2^53 —
// exactly where the Number-backed `Fraction` (its guard `narrow`) has to refuse
// them. So the kernel carries its fractionOfGrant and its running cumulative as
// `BigRational` end to end and only narrows to a share count at the integer
// floor, never back to a Number `Fraction`. Kept reduced after every operation so
// operands can't grow unbounded across a long cumulative chain. Denominators here
// are always positive (every operand widens from a validated positive-denominator
// Fraction, and product/sum of positives stays positive).
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

// Compare two rationals without dividing: a/b vs c/d has the same ordering as a·d
// vs c·b, since every denominator here is positive. The cross products run in
// BigInt, so the ordering stays exact at any size — a strictly larger denominator
// against an equal numerator reads strictly smaller, where a Number cross product
// would round the two equal. Operands need not be reduced. Returns -1, 0, or 1.
export const bigCmp = (a: BigRational, b: BigRational): -1 | 0 | 1 => {
  const lhs = a.numerator * b.denominator;
  const rhs = b.numerator * a.denominator;
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
};

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

// The sole narrowing point, and the sole guard. Reduce an exact `BigRational`
// (via the shared `bigReduce`) and bring it back to a Number `Fraction`. A
// component that survives reduction but still exceeds Number.MAX_SAFE_INTEGER
// can't be represented exactly, so refuse it loudly rather than let the Number
// cast round it. The ceiling is inclusive: 2^53 − 1 is the largest value a Number
// holds exactly, so a component exactly at it is accepted.
const narrow = (r: BigRational): Fraction => {
  const { numerator: n, denominator: den } = bigReduce(
    r.numerator,
    r.denominator,
  );
  const overflows = (v: bigint): boolean => (v < 0n ? -v : v) > MAX_SAFE;
  if (overflows(n) || overflows(den)) {
    throw new Error(
      `fraction component exceeds Number.MAX_SAFE_INTEGER after reduction ` +
        `(${n}/${den}); the grant or schedule is too large to allocate exactly`,
    );
  }
  return { numerator: Number(n), denominator: Number(den) };
};

export const ZERO: Fraction = { numerator: 0, denominator: 1 };
const ONE: Fraction = { numerator: 1, denominator: 1 };

// Reduce a `Fraction` to lowest terms, sign on the numerator. A pure widen to
// BigInt then a narrow back — `toBigRational` doesn't reduce, so `narrow` does.
export const fracReduce = (f: Fraction): Fraction => narrow(toBigRational(f));

const fracAdd = (a: Fraction, b: Fraction): Fraction =>
  narrow(bigAdd(toBigRational(a), toBigRational(b)));

/** Sum a list of fractions (empty list → 0). */
export const fracSum = (fs: Fraction[]): Fraction => fs.reduce(fracAdd, ZERO);

const fracCmp = (a: Fraction, b: Fraction): -1 | 0 | 1 =>
  bigCmp(toBigRational(a), toBigRational(b));

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
