// Exact-rational, integer-emitting allocation. Two entry points share one
// implementation:
//
//   allocateExact   The per-step telescoping primitive: a running cumulative
//                   fraction plus vestedSoFar. compile drives one cumulative
//                   across the whole ordered template through it, and the
//                   evaluator's events-only/unresolved rendering reuses it.
//   allocateVector  The N-way even split for all six allocation modes. This is
//                   the exact-rational replacement for the legacy float
//                   `allocateQuantity`.
//
// The cumulative modes are restated over Fraction: the old
// `Math.floor((i+1)/n · q)` becomes the exact `floor(q · (i+1)/n)` in BigInt
// (floorSharesAt). The four loaded modes were already exact integer
// base+remainder, so they carry over verbatim.

import type { AllocationType, Fraction } from "@vestlang/types";

/**
 * floor(totalShares × cumulative), computed in BigInt so the intermediate
 * product is exact even when totalShares × numerator would overflow
 * Number.MAX_SAFE_INTEGER. The quotient is bounded by totalShares (safe-integer
 * by precondition), so the Number() cast is safe.
 */
export const floorSharesAt = (
  totalShares: number,
  cumulative: Fraction,
): number => {
  const total = BigInt(totalShares);
  const num = BigInt(cumulative.numerator);
  const den = BigInt(cumulative.denominator);
  return Number((total * num) / den);
};

/**
 * round(totalShares × cumulative), half rounded up (matching the legacy
 * `Math.round` for non-negative values), computed exactly in BigInt:
 * round(p/q) = floor((2p + q) / 2q).
 */
export const roundSharesAt = (
  totalShares: number,
  cumulative: Fraction,
): number => {
  const total = BigInt(totalShares);
  const num = BigInt(cumulative.numerator);
  const den = BigInt(cumulative.denominator);
  const p = total * num;
  return Number((2n * p + den) / (2n * den));
};

/**
 * The per-step amount for a cumulative allocation: (floor|round)(totalShares ×
 * cumulative) − vestedSoFar, where `cumulative` is the running exact-rational
 * fraction-of-grant scheduled through this step. Added to vestedSoFar across
 * steps, the amounts telescope to exactly totalShares once cumulative hits 1/1.
 *
 * Only the cumulative modes use the running-fraction model; the loaded modes
 * are an N-way split with no per-step cumulative — use allocateVector for those.
 */
export const allocateExact = (
  totalShares: number,
  cumulative: Fraction,
  vestedSoFar: number,
  mode: AllocationType = "CUMULATIVE_ROUND_DOWN",
): number => {
  switch (mode) {
    case "CUMULATIVE_ROUND_DOWN":
      return floorSharesAt(totalShares, cumulative) - vestedSoFar;
    case "CUMULATIVE_ROUNDING":
      return roundSharesAt(totalShares, cumulative) - vestedSoFar;
    case "FRONT_LOADED":
    case "BACK_LOADED":
    case "FRONT_LOADED_TO_SINGLE_TRANCHE":
    case "BACK_LOADED_TO_SINGLE_TRANCHE":
      throw new Error(
        `allocateExact does not support the non-cumulative mode "${mode}"; use allocateVector for an N-way split.`,
      );
  }
};

/**
 * Split an integer quantity across N installments per the allocation mode.
 * Exact-rational replacement for the legacy float `allocateQuantity`:
 *   - cumulative modes loop allocateExact with cumulative = (i+1)/n,
 *   - loaded modes use integer base+remainder (verbatim from legacy).
 */
export const allocateVector = (
  quantity: number,
  n: number,
  mode: AllocationType,
): number[] => {
  if (n <= 0) return [];

  switch (mode) {
    case "CUMULATIVE_ROUND_DOWN":
    case "CUMULATIVE_ROUNDING": {
      const out = new Array<number>(n).fill(0);
      let vestedSoFar = 0;
      for (let i = 0; i < n; i++) {
        const amt = allocateExact(
          quantity,
          { numerator: i + 1, denominator: n },
          vestedSoFar,
          mode,
        );
        out[i] = amt;
        vestedSoFar += amt;
      }
      return out;
    }

    case "FRONT_LOADED": {
      const base = Math.floor(quantity / n);
      const remainder = quantity % n;
      return Array.from({ length: n }, (_, i) =>
        i < remainder ? base + 1 : base,
      );
    }

    case "BACK_LOADED": {
      const base = Math.floor(quantity / n);
      const remainder = quantity % n;
      return Array.from({ length: n }, (_, i) =>
        i >= n - remainder ? base + 1 : base,
      );
    }

    case "FRONT_LOADED_TO_SINGLE_TRANCHE": {
      const base = Math.floor(quantity / n);
      const remainder = quantity % n;
      return [base + remainder, ...Array.from({ length: n - 1 }, () => base)];
    }

    case "BACK_LOADED_TO_SINGLE_TRANCHE": {
      const base = Math.floor(quantity / n);
      const remainder = quantity % n;
      return [...Array.from({ length: n - 1 }, () => base), base + remainder];
    }
  }
};
