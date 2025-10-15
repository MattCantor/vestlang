import {
  AnyCondition,
  ConditionAtom,
  ASTNode,
  ASTNodeConstrained,
} from "@vestlang/dsl";
import { normalizeOffsets } from "./offsets.js";
import { stableKey, dedupe } from "./utils.js";
import {
  AndCondition,
  AtomCondition,
  BareVestingNode,
  Condition,
  ConstrainedVestingNode,
  OrCondition,
  VestingNode,
} from "../types/index.js";

/* ------------------------
 * Guards
 * ------------------------ */

/** Type guard for constrained vesting nodes */
function isConstrainedASTNode(x: any): x is ASTNodeConstrained {
  return !!x && typeof x === "object" && x.type === "CONSTRAINED";
}

function isConstrainedVestingNode(x: any): x is ConstrainedVestingNode {
  return !!x && typeof x === "object" && x.type === "CONSTRAINED";
}

function isBareVestingNode(x: any): x is BareVestingNode {
  return !!x && typeof x === "object" && x.type === "BARE";
}

/* ------------------------
 * Vesting Nodes
 * ------------------------ */

/**
 * Normalize a vesting node:
 * - Canonicalize offsets
 * - Normalize constraints (if CONSTRAINED)
 */
export function normalizeVestingNode(n: ASTNode): VestingNode {
  const base = n.base;
  const offsets = normalizeOffsets(n.offsets);

  if (isConstrainedASTNode(n)) {
    const constraints = normalizeCondition(n.constraints);
    return {
      type: "CONSTRAINED",
      base,
      offsets,
      constraints,
    } as ConstrainedVestingNode;
  }
  return {
    type: "BARE",
    base,
    offsets,
  } as BareVestingNode;
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
function normalizeCondition(node: AnyCondition): Condition {
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
      } as AndCondition | OrCondition;

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
function normalizeAtom(a: ConditionAtom): Condition {
  const normalizedBase = normalizeVestingNode(a.constraint.base);

  if (isConstrainedVestingNode(normalizedBase)) {
    const bare: BareVestingNode = {
      type: "BARE",
      base: normalizedBase.base,
      offsets: normalizedBase.offsets,
    };
    const leaf: AtomCondition = {
      type: "ATOM",
      constraint: { ...a.constraint, base: bare },
    };
    // Delegate combining and secondary normalization to caller (AND path)
    return normalizeCondition({
      type: "AND",
      items: [normalizedBase.constraints, leaf],
    }) as AndCondition;
  }

  if (isBareVestingNode(normalizedBase)) {
    return {
      type: "ATOM",
      constraint: { ...a.constraint, base: normalizedBase },
    };
  }

  throw new Error(
    `normalizeAtom: unexpected vesting node type ${(a as any)?.type} `,
  );
}

/**
 * If a node is an ATOM whose base is CONSTRAINED, return two items:
 * - the hoisted constraints, and
 * - the same ATOM with a BARE base.
 * Otherwise, return the node unchanged.
 *
 * The caller (parent group) will take care of flattening/sorting/deduping.
 */
function hoistIfConstrainedBase(c: Condition): Condition[] {
  if (c.type !== "ATOM") return [c];

  const vestingNode = c.constraint.base;
  if (isConstrainedVestingNode(vestingNode)) {
    const bare: BareVestingNode = {
      type: "BARE",
      base: vestingNode.base,
      offsets: vestingNode.offsets,
    };
    const leaf: AtomCondition = {
      type: "ATOM",
      constraint: { ...c.constraint, base: bare },
    };
    // Caller (normalizeCondition on the parent group) will flatten/sort/dedupe
    return [vestingNode.constraints, leaf];
  }
  return [c];
}
