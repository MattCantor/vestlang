import type {
  Condition,
  Constraint,
  Duration,
  Offsets,
  VestingBase,
  VestingNode,
  VestingNodeExpr,
} from "@vestlang/types";
import { kw, parenGroup } from "./utils.js";

/**
 * Stringify a VestingNodeExpr (SINGLETON, LATER_OF, or EARLIER_OF).
 */
export function stringifyVestingNodeExpr(node: VestingNodeExpr): string {
  switch (node.type) {
    case "SINGLETON":
      return stringifyVestingNode(node);
    case "EARLIER_OF":
    case "LATER_OF": {
      const keyword = kw(node.type.replace("_", " "));
      const items = node.items.map((item) => stringifyVestingNodeExpr(item));
      return parenGroup(keyword, items);
    }
  }
}

/**
 * Stringify a VestingNode (base + offsets + constraints).
 */
export function stringifyVestingNode(node: VestingNode): string {
  const parts: string[] = [];
  parts.push(stringifyVestingBase(node.base));
  const offsets = stringifyOffsets(node.offsets);
  if (offsets) {
    parts.push(offsets);
  }
  if (node.constraints) {
    parts.push(stringifyCondition(node.constraints));
  }
  return parts.join(" ");
}

/**
 * Stringify a Duration (e.g., "+1 months" or "-2 days").
 */
export function stringifyDuration(d: Duration): string {
  const sign = d.sign === "MINUS" ? "-" : "+";
  return `${sign}${d.value} ${d.unit.toLowerCase()}`;
}

/**
 * Stringify a Condition (ATOM, AND, or OR).
 */
export function stringifyCondition(node: Condition): string {
  switch (node.type) {
    case "ATOM":
      return stringifyConstraint(node.constraint);
    case "AND":
    case "OR": {
      const keyword = kw(node.type);
      const items = node.items.map(stringifyCondition);
      return parenGroup(keyword, items);
    }
  }
}

/**
 * Stringify a Constraint (BEFORE/AFTER with optional STRICTLY).
 */
function stringifyConstraint(c: Constraint): string {
  const parts: string[] = [];
  if (c.strict) {
    parts.push(kw("STRICTLY"));
  }
  parts.push(kw(c.type));
  parts.push(stringifyVestingNode(c.base));
  return parts.join(" ");
}

/**
 * Stringify offsets array.
 */
function stringifyOffsets(offsets: Offsets): string {
  if (!offsets || offsets.length === 0) return "";
  return offsets.map(stringifyDuration).join(" ");
}

/**
 * Stringify a vesting base (EVENT or DATE).
 */
function stringifyVestingBase(base: VestingBase): string {
  return `${kw(base.type)} ${base.value}`;
}
