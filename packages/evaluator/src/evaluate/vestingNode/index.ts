import type {
  ConstrainedVestingNode,
  EvaluationContext,
  ImpossibleBlocker,
  NodeMeta,
  VestingNode,
} from "@vestlang/types";
import { evaluateVestingBase } from "./vestingBase.js";
import { evaluateConstrainedVestingNode } from "./constrainedVestingNode.js";

/* ------------------------
 * Helpers
 * ------------------------ */

function allImpossibleBlockers(x: any[]): x is ImpossibleBlocker[] {
  return (
    !!x &&
    typeof x === "object" &&
    x.every((blocker) => blocker.type.split("_")[0] === "IMPOSSIBLE")
  );
}

/* ------------------------
 * Public API
 * ------------------------ */

export function evaluateVestingNode(
  node: VestingNode,
  ctx: EvaluationContext,
): NodeMeta {
  // Resolve the vesting node base
  const resBase = evaluateVestingBase(node, ctx);

  // Return the resolved vesting node base if there are no constraints
  if (!node.constraints) return resBase;

  // Resolve constraints
  const blockers = evaluateConstrainedVestingNode(
    node as ConstrainedVestingNode,
    resBase,
    node.constraints,
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
