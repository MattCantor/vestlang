import type {
  Blocker,
  ConstrainedVestingNode,
  ResolutionContext,
  ImpossibleBlocker,
  NodeMeta,
  VestingNode,
} from "@vestlang/types";
import { isImpossibleBlocker } from "../blockerTree.js";
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

export function evaluateVestingNode(
  node: VestingNode,
  ctx: ResolutionContext,
): NodeMeta {
  // Resolve the vesting node base as the schedule's own anchor: a MONTHS offset
  // here snaps to the policy only when the node hangs off the vesting start (the
  // cadence cliff), which evaluateVestingBase decides from the "anchor" role.
  const resBase = evaluateVestingBase(node, ctx, "anchor");

  // Return the resolved vesting node base if there are no constraints
  if (!node.condition) return resBase;

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
