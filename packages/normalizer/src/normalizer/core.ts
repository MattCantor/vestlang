import { normalizeAndDedupe, type FindingSink } from "./utils.js";
import { AtomCondition, Condition, VestingNode } from "@vestlang/types";

/* ------------------------
 * Vesting Nodes
 * ------------------------ */

/**
 * Normalize a vesting node:
 * - Normalize constraints (if CONSTRAINED)
 */
export function normalizeVestingNode(
  node: VestingNode,
  report?: FindingSink,
): VestingNode {
  if (node.condition) {
    return {
      ...node,
      condition: normalizeCondition(node.condition, report),
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
 * - Flatten same-op boolean groups in place (authored order preserved)
 * - Dedupe items, keeping the first occurrence
 * - Collapse singletons: AND(x) -> x, OR(x) -> x
 */
function normalizeCondition(node: Condition, report?: FindingSink): Condition {
  switch (node.type) {
    case "ATOM":
      return normalizeAtom(node, report);
    case "AND":
    case "OR": {
      // A bare `a OR b AND c` the parser flagged as mixed-infix: report how the
      // precedence grouped it, then drop the transient markers (`grouped`,
      // `mixedInfix`) so the canonical output is clean — normalizeAndDedupe spreads
      // the node, so they'd otherwise leak onto the normalized tree.
      const { mixedInfix, grouped: _grouped, ...rest } = node;
      if (mixedInfix) report?.({ kind: "mixed-boolean", loc: mixedInfix });
      return normalizeAndDedupe(rest, (c) => normalizeCondition(c, report));
    }
    default:
      throw new Error(
        `normalizeCondition: unexpected condition type ${(node as { type?: string })?.type}`,
      );
  }
}

/**
 * Normalize an ATOM's base vesting node
 */
function normalizeAtom(a: AtomCondition, report?: FindingSink): AtomCondition {
  const normalizedBase = normalizeVestingNode(a.constraint.base, report);

  return {
    type: "ATOM",
    constraint: { ...a.constraint, base: normalizedBase },
  };
}
