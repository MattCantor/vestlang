// Template-space allocation diagnostics for the canonical interchange.

import type { Finding, VestingScheduleTemplate } from "@vestlang/types";
import { allocationFindingsFromFractions } from "@vestlang/utils";

// The over/under-allocation check, run against a stored template rather than a
// live resolution: sum the statements' share-of-grant fractions and classify.
// This is what lets a persisted artifact be re-validated on rehydrate without
// re-resolving it — the authored percentages already carry everything the sum
// needs. Cliff percentages don't enter: a cliff's percentage is a share *of its
// own statement*, already bounded to [0,1], not an additional claim on the grant.
//
// It runs the same shared `allocationFindingsFromFractions` primitive the
// evaluator's resolution-space `allocationFindings` does, so the two paths can't
// drift on where the over/under boundary sits or what the finding looks like.
export const templateAllocationFindings = (
  template: VestingScheduleTemplate,
  totalShares: number,
): Finding[] =>
  allocationFindingsFromFractions(
    template.statements.map((s) => s.percentage),
    totalShares,
  );
