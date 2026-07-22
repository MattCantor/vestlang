import type {
  Blocker,
  CommittedNode,
  ConstrainedVestingNode,
  ResolutionContext,
  ImpossibleBlocker,
  NodeMeta,
  VestingNode,
} from "@vestlang/types";
import {
  isEmptySatisfiableSet,
  isSameAnchorImpossible,
} from "@vestlang/primitives";
import { isImpossibleBlocker } from "../blockerTree.js";
import { createGateImpossibleBlocker } from "./constraint.js";
import { evaluateVestingBase } from "./vestingBase.js";
import { evaluateConstrainedVestingNode } from "./constrainedVestingNode.js";

/* ------------------------
 * Helpers
 * ------------------------ */

// A node is impossible only when every blocker is a contradiction; one merely
// pending blocker leaves the whole node unresolved. The condition combiner already
// drops moot operands (a pending conjunct beside a dead one, a dead arm beside a live
// one), so by the time the list arrives here it is clean: all-impossible iff dead.
const allImpossibleBlockers = (x: Blocker[]): x is ImpossibleBlocker[] =>
  x.every(isImpossibleBlocker);

/* ------------------------
 * Public API
 * ------------------------ */

// A leaf node resolves to a date, stays pending, or is dead — it never commits a
// floor (only a selector does, in selectors.ts), so COMMITTED is excluded from the
// return. That exclusion is what lets the picker re-emit a non-RESOLVED leaf
// straight through as a `PickReturn` (which has no bare COMMITTED arm).
export function evaluateVestingNode(
  node: VestingNode,
  ctx: ResolutionContext,
): Exclude<NodeMeta, CommittedNode> {
  // Resolve the vesting node base as the schedule's own anchor: a MONTHS offset
  // here snaps to the policy only when the node hangs off the vesting start (the
  // cadence cliff), which evaluateVestingBase decides from the "anchor" role.
  const resBase = evaluateVestingBase(node, ctx, "anchor");

  // Return the resolved vesting node base if there are no constraints
  if (!node.condition) return resBase;

  // Two firing-invariant contradictions get caught here, before the per-operand
  // combiner runs, because that combiner can't see either: each conjunct is
  // individually a satisfiable "wait, bounded on one side", so it reads the node
  // as merely pending.
  //
  //   - Jointly-empty date windows — the constraints don't overlap
  //     (`EVENT ipo AFTER 2026-01-01 AND BEFORE 2025-01-01`); no firing on any
  //     date lands inside.
  //   - Same-anchor contradictions — both sides pin to one non-date symbol, so
  //     the symbol cancels and what's left is impossible regardless of when it
  //     fires (`EVENT ipo STRICTLY AFTER EVENT ipo`).
  //
  // Both are firing-invariant, so run them once here on the whole condition (this
  // entry sees each gate exactly once) and short-circuit to a single impossible
  // blocker carrying the whole gate. Replacing the combiner's output — not
  // appending to it — is what makes the node classify IMPOSSIBLE: a mixed list of
  // one impossible plus the pending EVENT_NOT_YET_OCCURRED blockers would read
  // UNRESOLVED instead.
  if (isEmptySatisfiableSet(node.condition) || isSameAnchorImpossible(node)) {
    return {
      type: "IMPOSSIBLE",
      blockers: [createGateImpossibleBlocker(node)],
    };
  }

  // Resolve constraints
  const blockers = evaluateConstrainedVestingNode(
    node as ConstrainedVestingNode,
    resBase,
    node.condition,
    ctx,
  );

  // Return the resolved vesting node base if all constraints succeeded
  if (!blockers || blockers.length === 0) return resBase;

  // Compile and return a new Node
  if (allImpossibleBlockers(blockers)) {
    return {
      type: "IMPOSSIBLE",
      blockers,
    };
  }
  return {
    type: "UNRESOLVED",
    blockers,
  };
}
