import {
  AnyCondition,
  ConditionAndGroup,
  ConditionAtom,
  ConditionOrGroup,
  TemporalConstraint,
  VestingNode,
  VestingNodeBare,
  VestingNodeConstrained,
} from "@vestlang/dsl";
import { normalizeOffsets } from "./offsets.js";
import { stableKey, dedupe } from "./utils.js";

/* ------------------------
 * Guards
 * ------------------------ */

/** Type guard for constrained vesting nodes */
export function isConstrainedNode(x: any): x is VestingNodeConstrained {
  return !!x && typeof x === "object" && x.type === "CONSTRAINED";
}

/* ------------------------
 * Vesting Nodes
 * ------------------------ */

/**
 * Normalize a vesting node:
 * - Canonicalize offsets
 * - Normalize constraints (if CONSTRAINED)
 */
export function normalizeVestingNode(n: VestingNode): VestingNode {
  const base = n.base;
  const offsets = normalizeOffsets(n.offsets);

  if (isConstrainedNode(n)) {
    const constraints = normalizeCondition(n.constraints);
    return {
      type: "CONSTRAINED",
      base,
      offsets,
      constraints,
    } as VestingNodeConstrained;
  }
  return {
    type: "BARE",
    base,
    offsets,
  };
}

/* ------------------------
 * Conditions
 * ------------------------ */

/**
 * Normalize any condition node:
 * - Normalize children
 * - Hoist constrained bases out of `ATOM`s
 * - Flatten same-op boolean groups
 * - Sort & dedupe items for determinism
 * - Collapse singletons: AND(x) -> x, OR(x) -> x
 *
 * Ensures no ATOM has a CONSTRAINED base after normalization
 */
function normalizeCondition(node: AnyCondition): AnyCondition {
  switch (node.type) {
    case "ATOM":
      return normalizeAtom(node);
    case "AND":
    case "OR":
      // Normalize children
      let items = node.items.map(normalizeCondition);

      // hoist constrained bases out of any ATOM children
      items = items.flatMap(hoistIfConstrainedBase);

      // flatten same-op groups
      items = items.flatMap((item) =>
        item.type === node.type ? (item as any).items : [item],
      );

      // Sort & dedupe
      items = dedupe(items).sort((a, b) =>
        stableKey(a).localeCompare(stableKey(b)),
      );

      // Collapse singletons
      if (items.length === 1) return items[0];

      return {
        type: node.type,
        items,
      } as ConditionAndGroup | ConditionOrGroup;

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
function normalizeAtom(a: ConditionAtom): AnyCondition {
  const baseNorm = normalizeVestingNode(a.constraint.base as VestingNode);

  if (isConstrainedNode(baseNorm)) {
    const bare: VestingNodeBare = {
      type: "BARE",
      base: baseNorm.base,
      offsets: baseNorm.offsets,
    };
    const leaf: ConditionAtom = {
      type: "ATOM",
      constraint: { ...a.constraint, base: bare } as TemporalConstraint,
    };
    // Delegate combining and secondary normalization to caller (AND path)
    return normalizeCondition({
      type: "AND",
      items: [baseNorm.constraints, leaf] as any,
    });
  }

  return {
    type: "ATOM",
    constraint: { ...a.constraint, base: baseNorm } as TemporalConstraint,
  };
}

/**
 * If a node is an ATOM whose base is CONSTRAINED, return two items:
 * - the hoisted constraints, and
 * - the same ATOM with a BARE base.
 * Otherwise, return the node unchanged.
 *
 * The caller (parent group) will take care of flattening/sorting/deduping.
 */
function hoistIfConstrainedBase(n: AnyCondition): AnyCondition[] {
  if (n.type !== "ATOM") return [n];

  const b = n.constraint.base as VestingNode;
  if (isConstrainedNode(b)) {
    const bare: VestingNodeBare = {
      type: "BARE",
      base: b.base,
      offsets: b.offsets,
    };
    const leaf: ConditionAtom = {
      type: "ATOM",
      constraint: { ...n.constraint, base: bare } as TemporalConstraint,
    };
    // Caller (normalizeCondition on the parent group) will flatten/sort/dedupe
    return [b.constraints as AnyCondition, leaf];
  }
  return [n];
}
