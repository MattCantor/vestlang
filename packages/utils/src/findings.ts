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
  // A grant of zero shares can't over- or under-allocate — there's nothing to
  // allocate against — so any sum is moot and we raise no finding.
  if (totalShares === 0) return [];

  const sum = fracSum(fractions);
  const where = classifyAllocation(sum);
  if (where === "over") {
    return [
      { kind: "over-allocation", severity: "error", sum, path: ["Program"] },
    ];
  }
  if (where === "under") {
    return [
      { kind: "under-allocation", severity: "warning", sum, path: ["Program"] },
    ];
  }
  return [];
};
