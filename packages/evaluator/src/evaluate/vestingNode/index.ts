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
// pending blocker leaves the whole node unresolved.
const allImpossibleBlockers = (x: Blocker[]): x is ImpossibleBlocker[] =>
  x.every(isImpossibleBlocker);

/* ------------------------
 * Public API
 * ------------------------ */

export function evaluateVestingNode(
  node: VestingNode,
  ctx: ResolutionContext,
): NodeMeta {
  // Resolve the vesting node base
  const resBase = evaluateVestingBase(node, ctx);

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
