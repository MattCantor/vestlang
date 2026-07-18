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
  it("flags an over-allocating sum at a zero-share grant", () => {
    // Over-allocation is a grant-independent ratio: 3× the grant is wrong no
    // matter the share count, so the error still fires against zero shares.
    expect(allocationFindingsFromFractions([f(3, 1)], 0)).toEqual([
      {
        kind: "over-allocation",
        severity: "error",
        sum: { numerator: 3, denominator: 1 },
        path: ["Program"],
      },
    ]);
  });

  it("raises nothing at a zero-share grant when the sum is within the grant", () => {
    // Under-allocation stays silent against zero shares (nothing to leave
    // unvested), and an exactly-100% sum raises nothing anywhere.
    expect(allocationFindingsFromFractions([f(1, 2)], 0)).toEqual([]);
    expect(allocationFindingsFromFractions([f(1, 2), f(1, 2)], 0)).toEqual([]);
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
