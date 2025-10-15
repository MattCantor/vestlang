import { NormalizeAndSort } from "./utils.js";
import {
  BareVestingNode,
  Condition,
  ConstrainedVestingNode,
  RawAtomCondition,
  RawCondition,
  RawConstrainedVestingNode,
  RawVestingNode,
  VestingNode,
} from "@vestlang/types";

/* ------------------------
 * Vesting Nodes
 * ------------------------ */

/**
 * Normalize a vesting node:
 * - Normalize constraints (if CONSTRAINED)
 */
export function normalizeVestingNode(node: RawVestingNode): VestingNode {
  switch (node.type) {
    case "CONSTRAINED":
      return {
        ...node,
        constraints: normalizeCondition(
          (node as RawConstrainedVestingNode).constraints,
        ),
      } as ConstrainedVestingNode;
    case "BARE":
      return node as BareVestingNode;
  }
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
function normalizeCondition(node: RawCondition): Condition {
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
 * Normalize an ATOM:
 * - Normalize its base vesting node
 * - If base is CONSTRAINED, hoist the inner constraints:
 *   ATOM(op, base=CONSTRAINED(B, C2))  ⇒  AND( C2 , ATOM(op, base=BARE(B)) )
 */
function normalizeAtom(a: RawAtomCondition): Condition {
  const base = a.constraint.base;

  switch (base.type) {
    case "CONSTRAINED":
      const bare: BareVestingNode = {
        ...base,
        type: "BARE",
        constraints: undefined,
      };

      const leaf: RawAtomCondition = {
        type: "ATOM",
        constraint: { ...a.constraint, base: bare },
      };

      // Build a RAW AND node, then normalize it to canonical
      const rawAnd: RawCondition = {
        type: "AND",
        items: [(base as RawConstrainedVestingNode).constraints, leaf],
      };

      return normalizeCondition(rawAnd);

    case "BARE":
      return {
        type: "ATOM",
        constraint: {
          ...a.constraint,
          base: base as BareVestingNode,
        },
      };
    default:
      throw new Error(
        `normalizeAtom: unexpected condition type ${(a as any)?.type}`,
      );
  }
}
