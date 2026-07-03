// Symbolic share claims — the integer a not-yet-dated portion stakes on the
// grant. Same discipline as the dated allocator: one running cumulative, floored
// to whole shares at each step, never past the grant.

import type { Amount, Fraction } from "@vestlang/types";
import type { BigRational } from "@vestlang/utils";
import { floorSharesAt } from "@vestlang/primitives";
import {
  BIG_ONE,
  bigAdd,
  bigCmp,
  fracReduce,
  toBigRational,
  ZERO,
} from "@vestlang/utils";

/** DSL amount → canonical portion. QUANTITY `v` → `v / totalShares`.
 *  A zero-share grant has nothing for a QUANTITY to claim, so it lowers to 0
 *  (vests nothing) rather than the degenerate `v/0`. That fraction is invalid
 *  (validate rejects denominator < 1) and would otherwise crash downstream — the
 *  template validator or `floorSharesAt`. PORTION amounts carry their own
 *  denominator and never touch the grant count, so they're left alone. */
export const amountToFraction = (a: Amount, totalShares: number): Fraction =>
  a.type === "QUANTITY"
    ? totalShares === 0
      ? ZERO
      : fracReduce({ numerator: a.value, denominator: totalShares })
    : fracReduce({ numerator: a.numerator, denominator: a.denominator });

// floor(grant × cumulative), capped at the grant. Claims feed surfaces with no
// findings channel, so an over-allocating author must not read back more shares
// than the grant holds; the over-allocation finding owns the excess. Comparing against one first is the cap itself, not a
// workaround — floorSharesAt accepts an over-1 cumulative (it enforces its cast
// bound on the quotient), but a claim never wants the over-grant number anyway.
const sharesThrough = (
  grantQuantity: number,
  cumulative: BigRational,
): number =>
  bigCmp(cumulative, BIG_ONE) > 0
    ? grantQuantity
    : floorSharesAt(grantQuantity, cumulative);

// The symbolic twin of allocateEvents' running cumulative: each draw adds one
// statement's fraction and returns the whole shares that step uncovers. The
// cumulative rides as an exact `BigRational` and only collapses to shares at the
// floor — narrowing it to a Number mid-sum is what overflows at large grants — so
// each draw folds in with `bigAdd` and the guard lives entirely on the quotient.
// Draws telescope: a fresh cursor drained over a program's fractions sums to
// min(floor(grant × Σ fractions), grant) exactly. `basis` seeds the cumulative
// with fractions someone else already delivered (the dated statements).
export const claimAllocator = (
  grantQuantity: number,
  basis: Fraction = ZERO,
): ((fraction: Fraction) => number) => {
  let cumulative = toBigRational(basis);
  let claimed = sharesThrough(grantQuantity, cumulative);
  return (fraction) => {
    cumulative = bigAdd(cumulative, toBigRational(fraction));
    const next = sharesThrough(grantQuantity, cumulative);
    const claim = next - claimed;
    claimed = next;
    return claim;
  };
};
