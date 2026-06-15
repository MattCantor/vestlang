// Resolve a bare anchor expression straight to its date — no allocation, no
// installments, no grant-date fold. This is the same operation rehydration runs
// per stored event (createEvaluationContext + evaluateVestingNodeExpr +
// isPickedResolved), exposed as one focused entry so a caller that only wants the
// resolved start needn't reach into the selector layer or hand-build a context.
//
// The three result arms `evaluateVestingNodeExpr` can return are all reachable for
// a bare anchor and each collapses to one of two outcomes:
//   - PICKED + RESOLVED meta            → resolved, with the date
//   - PICKED + UNRESOLVED meta          → not resolved (a partial LATER OF)
//   - top-level UNRESOLVED / IMPOSSIBLE → not resolved (e.g. a contradictory gate)
// The not-resolved arms gather their blockers and render a reason through the same
// blockerToString machinery the installment path uses, so the wording matches.

import type {
  Blocker,
  OCTDate,
  ResolutionContextInput,
  VestingNodeExpr,
} from "@vestlang/types";
import { createEvaluationContext } from "../utils.js";
import { evaluateVestingNodeExpr } from "./selectors.js";
import { isPickedResolved, type PickReturn } from "./utils.js";
import { blockerToString } from "./blockerToString.js";

export type ResolvedAnchor =
  | { resolved: true; date: OCTDate }
  | { resolved: false; blockers: Blocker[]; reason: string };

// Blockers of a non-resolved pick — same extraction rehydrate's blockersOf does:
// a PICKED-unresolved carries them on its meta, every other non-PICKED arm on the
// result itself.
const blockersOf = (res: PickReturn<unknown>): Blocker[] => {
  if (res.type === "PICKED") {
    return res.meta.type === "UNRESOLVED" ? res.meta.blockers : [];
  }
  return res.blockers;
};

export function resolveVestingStart(
  expr: VestingNodeExpr,
  ctxInput: ResolutionContextInput,
): ResolvedAnchor {
  const ctx = createEvaluationContext(ctxInput);
  const res = evaluateVestingNodeExpr(expr, ctx);

  if (isPickedResolved(res)) {
    return { resolved: true, date: res.meta.date };
  }

  const blockers = blockersOf(res);
  return {
    resolved: false,
    blockers,
    reason: blockers.map(blockerToString).join(", "),
  };
}
