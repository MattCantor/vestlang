import { NormalizeAndSort } from "./utils.js";
import { AtomCondition, Condition, VestingNode } from "@vestlang/types";

/* ------------------------
 * Vesting Nodes
 * ------------------------ */

/**
 * Normalize a vesting node:
 * - Normalize constraints (if CONSTRAINED)
 */
export function normalizeVestingNode(node: VestingNode): VestingNode {
  if (node.constraints) {
    return {
      ...node,
      constraints: normalizeCondition(node.constraints),
    };
  }
  return node;
}

/* ------------------------
 * Conditions
 * ------------------------ */

/**
 * Normalize any condition node:
 * - Normalize children
 * - Flatten same-op boolean groups
 * - Sort & dedupe items for determinism
 * - Collapse singletons: AND(x) -> x, OR(x) -> x
 */
function normalizeCondition(node: Condition): Condition {
  switch (node.type) {
    case "ATOM":
      return normalizeAtom(node);
    case "AND":
    case "OR":
      return NormalizeAndSort(node, normalizeCondition);
    default:
      throw new Error(
        `normalizeCondition: unexpected condition type ${(node as any)?.type}`,
      );
  }
}

/**
 * Normalize an ATOM's base vesting node
 */
function normalizeAtom(a: AtomCondition): AtomCondition {
  const normalizedBase = normalizeVestingNode(a.constraint.base);

  return {
    type: "ATOM",
    constraint: { ...a.constraint, base: normalizedBase },
  };
}
