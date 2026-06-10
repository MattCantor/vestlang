import type {
  Blocker,
  ConstrainedVestingNode,
  EvaluationContext,
  ImpossibleBlocker,
  NodeMeta,
  VestingNode,
} from "@vestlang/types";
import { assertNever } from "@vestlang/utils";
import { evaluateVestingBase } from "./vestingBase.js";
import { evaluateConstrainedVestingNode } from "./constrainedVestingNode.js";

/* ------------------------
 * Helpers
 * ------------------------ */

// Which blockers are contradictions (vs. things still merely pending). Driven off
// the discriminant rather than the `IMPOSSIBLE_` name prefix, so adding a blocker
// variant fails the build here until it's classified — a mislabelled tag can't
// silently fall through to "unresolved".
const isImpossibleBlocker = (b: Blocker): b is ImpossibleBlocker => {
  switch (b.type) {
    case "IMPOSSIBLE_SELECTOR":
    case "IMPOSSIBLE_CONDITION":
      return true;
    case "EVENT_NOT_YET_OCCURRED":
    case "UNRESOLVED_SELECTOR":
    case "UNRESOLVED_CONDITION":
      return false;
    default:
      return assertNever(b);
  }
};

// A node is impossible only when every blocker is a contradiction; one merely
// pending blocker leaves the whole node unresolved.
const allImpossibleBlockers = (x: Blocker[]): x is ImpossibleBlocker[] =>
  x.every(isImpossibleBlocker);

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
