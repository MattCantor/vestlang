import { describe, it, expect } from "vitest";
import { allocationFindingsFromFractions } from "../src/findings";
import type { Fraction } from "@vestlang/types";

const f = (numerator: number, denominator: number): Fraction => ({
  numerator,
  denominator,
});

// The over/under-allocation rule, given raw share-of-grant fractions. Both the
// live resolution path and the template re-check run through here, so the
// boundary and the finding shape are pinned in one place.
describe("allocationFindingsFromFractions", () => {
  it("raises nothing for a zero-share grant — there is nothing to allocate against", () => {
    // Even an over-the-top sum is moot when the grant is zero.
    expect(allocationFindingsFromFractions([f(3, 1)], 0)).toEqual([]);
  });

  it("flags a sum over the whole grant as an error", () => {
    expect(allocationFindingsFromFractions([f(3, 4), f(1, 2)], 1000)).toEqual([
      {
        kind: "over-allocation",
        severity: "error",
        sum: { numerator: 5, denominator: 4 },
        path: ["Program"],
      },
    ]);
  });

  it("flags a sum short of the whole grant as a warning", () => {
    expect(allocationFindingsFromFractions([f(1, 2)], 1000)).toEqual([
      {
        kind: "under-allocation",
        severity: "warning",
        sum: { numerator: 1, denominator: 2 },
        path: ["Program"],
      },
    ]);
  });

  it("raises nothing when the fractions sum to exactly the whole grant", () => {
    expect(allocationFindingsFromFractions([f(1, 2), f(1, 2)], 1000)).toEqual(
      [],
    );
  });
});
