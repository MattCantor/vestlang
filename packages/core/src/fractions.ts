// Exact-rational arithmetic over the canonical `Fraction`.
//
// Core computes shares-of-grant in exact rational so a schedule telescopes to
// the total without float drift; these helpers keep fractions reduced as they
// combine.

import type { Fraction } from "@vestlang/types";

const gcd = (a: number, b: number): number => {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x || 1;
};

export const fracReduce = (f: Fraction): Fraction => {
  const d = gcd(f.numerator, f.denominator);
  return { numerator: f.numerator / d, denominator: f.denominator / d };
};

export const fracMul = (a: Fraction, b: Fraction): Fraction =>
  fracReduce({
    numerator: a.numerator * b.numerator,
    denominator: a.denominator * b.denominator,
  });

export const fracAdd = (a: Fraction, b: Fraction): Fraction =>
  fracReduce({
    numerator: a.numerator * b.denominator + b.numerator * a.denominator,
    denominator: a.denominator * b.denominator,
  });

export const fracSub = (a: Fraction, b: Fraction): Fraction =>
  fracReduce({
    numerator: a.numerator * b.denominator - b.numerator * a.denominator,
    denominator: a.denominator * b.denominator,
  });

export const ZERO: Fraction = { numerator: 0, denominator: 1 };
export const ONE: Fraction = { numerator: 1, denominator: 1 };

/** Sum a list of fractions (empty list → 0). */
export const fracSum = (fs: Fraction[]): Fraction => fs.reduce(fracAdd, ZERO);

// Compare two fractions without dividing: a/b vs c/d has the same ordering as
// a·d vs c·b, since every denominator in play here is positive. Returns -1, 0, or
// 1 — the usual comparator sign — so callers can ask `fracCmp(x, ONE) > 0` etc.
export const fracCmp = (a: Fraction, b: Fraction): -1 | 0 | 1 => {
  const lhs = a.numerator * b.denominator;
  const rhs = b.numerator * a.denominator;
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
};
