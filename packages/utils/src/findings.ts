// The over/under-allocation rule, given the raw share-of-grant fractions. The
// single home for "does this schedule allocate the whole grant?" — both the live
// resolution path (`allocationFindings`, in @vestlang/evaluator) and the
// template/persisted-template re-check (`templateAllocationFindings`, in
// @vestlang/core) run their fractions through here, so the two can't drift on
// where the boundary sits or what the finding looks like.
//
// Over the grant is an error — a grant can never vest more than 100% of itself.
// Under the grant is only a warning: leaving some of the grant unvested is a legal
// thing to write, just usually worth a heads-up.
//
// The `["Program"]` path is the AST node-path the resolution-path callers want;
// it's inert for the template path (the template carries no AST), but harmless
// there since downstream formatting reads only kind/sum/severity.

import type { Finding, Fraction } from "@vestlang/types";
import { classifyAllocation, fracSum } from "./fractions.js";

export const allocationFindingsFromFractions = (
  fractions: Fraction[],
  totalShares: number,
): Finding[] => {
  const sum = fracSum(fractions);
  const where = classifyAllocation(sum);
  if (where === "over") {
    // Over-allocation is a grant-independent ratio, so it fires even at zero
    // shares — where only PORTION sums can still exceed the grant, since QUANTITY
    // amounts have already lowered to ZERO.
    return [
      { kind: "over-allocation", severity: "error", sum, path: ["Program"] },
    ];
  }
  if (where === "under" && totalShares !== 0) {
    // Under-allocation is moot against a zero-share grant — nothing left to leave
    // unvested — so gate it there.
    return [
      { kind: "under-allocation", severity: "warning", sum, path: ["Program"] },
    ];
  }
  return [];
};
