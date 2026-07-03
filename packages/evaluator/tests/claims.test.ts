// The symbolic claim allocator carries its running cumulative as an exact
// BigRational, only collapsing to whole shares at the floor. The conservation
// sweep drives it end to end; this pins the one behavior only reachable at the
// allocator's own surface — a cumulative whose exact value runs past what a
// Number can hold, which the allocator must fold in without narrowing mid-sum.

import { describe, it, expect } from "vitest";
import type { Fraction } from "@vestlang/types";
import { claimAllocator } from "../src/claims";

const f = (numerator: number, denominator: number): Fraction => ({
  numerator,
  denominator,
});

describe("claimAllocator exact cumulative", () => {
  it("completes a max-scale sum whose reduced cumulative runs past 2^53", () => {
    // Two draws of 1/p and 1/q with distinct primes just below 2^53: their exact
    // sum reduces to (p+q)/(pq), a denominator far past 2^53. Folding it through a
    // Number fraction would refuse it mid-sum, but the BigRational cumulative
    // completes and only the floor turns each step into shares.
    const grant = Number.MAX_SAFE_INTEGER;
    const p = 9_007_199_254_740_881; // a prime below 2^53
    const q = 9_007_199_254_740_847; // a different prime below 2^53

    const draw = claimAllocator(grant);
    const first = draw(f(1, p));
    const second = draw(f(1, q));

    // Independent BigInt oracle for the telescoped floors: floor(grant × 1/p),
    // then floor(grant × (p+q)/(pq)) for the running total.
    const G = BigInt(grant);
    const P = BigInt(p);
    const Q = BigInt(q);
    expect(first).toBe(Number(G / P));
    expect(first + second).toBe(Number((G * (P + Q)) / (P * Q)));
  });
});
