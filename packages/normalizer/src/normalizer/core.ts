import { NormalizeAndSort } from "./utils.js";
import {
  AtomCondition,
  BareVestingNode,
  Condition,
  ConstrainedVestingNode,
  VestingNode,
} from "@vestlang/types";

/* ------------------------
 * Vesting Nodes
 * ------------------------ */

/**
 * Normalize a vesting node:
 * - Normalize constraints (if CONSTRAINED)
 */
export function normalizeVestingNode(node: VestingNode): VestingNode {
  switch (node.type) {
    case "CONSTRAINED":
      return {
        ...node,
        constraints: normalizeCondition(
          (node as ConstrainedVestingNode).constraints,
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

// function normalizeOffsets(offsets: Offsets): Offsets {
//   if (offsets.length === 0) return offsets;
//
//   let months = 0,
//     days = 0;
//
//   for (const o of offsets) {
//     const value = Math.abs(o.value);
//     const signed = o.sign === "MINUS" ? -value : value;
//     if (o.unit === "MONTHS") {
//       months += signed;
//     } else if (o.unit === "DAYS") {
//       days += signed;
//     } else {
//       throw new Error(`Unexpected offset type ${(o as any)?.type}`);
//     }
//   }
//
//   const out: Offsets = [];
//   if (months !== 0)
//     out.push({
//       type: "DURATION",
//       value: Math.abs(months),
//       unit: "MONTHS",
//       sign: months < 0 ? "MINUS" : "PLUS",
//     } as Duration);
//   return out;
// }
