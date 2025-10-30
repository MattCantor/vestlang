import {
  Condition,
  Constraint,
  Duration,
  Offsets,
  VestingBase,
  VestingNode,
} from "@vestlang/types";
import { Doc } from "prettier";
import { indent, join, kw, line } from "../builders.js";
import { printParenGroup } from "./utils.js";

/* ------------------------
 * API
 * ------------------------ */

export function printVestingNode(node: VestingNode): Doc {
  if (node.constraints) {
    return [
      [printVestingBase(node.base), printOffsets(node.offsets)],
      printCondition(node.constraints),
    ];
  }

  return [printVestingBase(node.base), printOffsets(node.offsets)];
}

export function printDuration(d: Duration): Doc {
  const sign = d.sign === "MINUS" ? "-" : "+";
  return `${sign}${d.value} ${d.unit.toLowerCase()}`;
}

/* ------------------------
 * Internal
 * ------------------------ */

function printCondition(node?: Condition): Doc {
  if (!node) return "";
  switch (node.type) {
    case "ATOM":
      return printConstraint(node.constraint);
    case "AND":
    case "OR":
      const keyword = kw(node.type);
      const items = node.items.map(printCondition);
      return printParenGroup(keyword, items);
  }
}

function printConstraint(c: Constraint): Doc {
  const strict = c.strict ? [kw("STRICTLY"), " "] : [];
  return indent([line, strict, kw(c.type), " ", printVestingNode(c.base)]);
}

function printOffsets(offsets: Offsets): Doc {
  if (!offsets || offsets.length === 0) return "";
  return [" ", join(" ", offsets.map(printDuration))];
}

function printVestingBase(base: VestingBase): Doc {
  if (base.type === "EVENT") return [kw("EVENT"), " ", base.value];
  return [kw("DATE"), " ", base.value];
}
