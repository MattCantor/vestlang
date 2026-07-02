// Exact-rational, integer-emitting allocation under CUMULATIVE_ROUND_DOWN — the
// engine's single allocation mode. Two entry points share one implementation:
//
//   allocateExact   The per-step telescoping primitive: a running cumulative
//                   fraction plus vestedSoFar. compile drives one cumulative
//                   across the whole ordered template through it, and the
//                   evaluator's events-only/unresolved rendering reuses it.
//   allocateVector  The N-way even split. Exact-rational replacement for the
//                   legacy float `allocateQuantity`.
//
// The old `Math.floor((i+1)/n · q)` becomes the exact `floor(q · (i+1)/n)` in
// BigInt (floorSharesAt).

import type { BigRational } from "@vestlang/utils";

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * floor(totalShares × cumulative), where `cumulative` is a BigInt-exact rational.
 * The kernel's cumulative reaches here without ever narrowing to a Number
 * `Fraction` (the narrowing is exactly what overflowed — see @vestlang/utils'
 * BigRational note): the exact rational's sole sink is this floor, which bounds
 * only the quotient. The Number() cast at the end is exact because both ends are
 * enforced, not assumed: totalShares must be a safe integer, and a quotient past
 * Number.MAX_SAFE_INTEGER is refused loudly — the same policy utils' toFraction
 * applies — rather than silently rounded. Note the cumulative itself may exceed
 * 1: an over-allocating template compiles under an error finding, so the dated
 * path legitimately asks for more than the grant, and the bound has to sit on the
 * quotient, not the fraction.
 */
export const floorSharesAt = (
  totalShares: number,
  cumulative: BigRational,
): number => {
  // Number.isInteger would admit 2^53 + 2; safe-integer is what the cast
  // contract actually needs. This also turns a fractional totalShares into a
  // named error instead of an opaque BigInt RangeError.
  if (!Number.isSafeInteger(totalShares)) {
    throw new Error(
      `floorSharesAt: totalShares must be a safe integer (got ${totalShares})`,
    );
  }
  // A valid rational has a positive denominator; reject anything else loudly
  // rather than letting BigInt throw an opaque "Division by zero". Callers
  // upstream never build such a rational, so this guards the public boundary.
  if (cumulative.denominator < 1n) {
    throw new Error(
      `floorSharesAt: cumulative.denominator must be >= 1 (got ${cumulative.denominator})`,
    );
  }
  const total = BigInt(totalShares);
  const q = (total * cumulative.numerator) / cumulative.denominator;
  const magnitude = q < 0n ? -q : q;
  if (magnitude > MAX_SAFE) {
    throw new Error(
      `floorSharesAt: floor(totalShares × cumulative) exceeds Number.MAX_SAFE_INTEGER (${q}); ` +
        `the grant or schedule is too large to allocate exactly`,
    );
  }
  return Number(q);
};

/**
 * The per-step amount for cumulative round-down allocation: floor(totalShares ×
 * cumulative) − vestedSoFar, where `cumulative` is the running exact BigInt
 * rational fraction-of-grant scheduled through this step. Added to vestedSoFar
 * across steps, the amounts telescope to exactly totalShares once cumulative
 * hits 1/1.
 */
export const allocateExact = (
  totalShares: number,
  cumulative: BigRational,
  vestedSoFar: number,
): number => floorSharesAt(totalShares, cumulative) - vestedSoFar;

/**
 * Split an integer quantity evenly across N installments (cumulative round-down):
 * loop allocateExact with cumulative = (i+1)/n.
 */
export const allocateVector = (quantity: number, n: number): number[] => {
  if (n <= 0) return [];

  const out = new Array<number>(n).fill(0);
  let vestedSoFar = 0;
  const den = BigInt(n);
  for (let i = 0; i < n; i++) {
    const amt = allocateExact(
      quantity,
      { numerator: BigInt(i + 1), denominator: den },
      vestedSoFar,
    );
    out[i] = amt;
    vestedSoFar += amt;
  }
  return out;
};
