import {
  Condition,
  VestingNode,
  Duration,
  Blocker,
  Constraint,
  Offsets,
  VestingBase,
} from "@vestlang/types";
import { foldBlocker } from "./blockerTree.js";

export function blockerToString(b: Blocker): string {
  return foldBlocker(b, (node, items) => {
    switch (node.type) {
      case "EVENT_NOT_YET_OCCURRED":
        return `EVENT ${node.event}`;
      case "UNRESOLVED_CONDITION":
      case "IMPOSSIBLE_CONDITION":
        return blockerConditionToString(node.condition);
      case "UNRESOLVED_SELECTOR":
      case "IMPOSSIBLE_SELECTOR":
        return node.selector === "EARLIER_OF"
          ? `EARLIER OF ( ${items.join(", ")} )`
          : `LATER OF ( ${items.join(", ")} )`;
    }
  });
}

function vestingNodeToString(node: VestingNode): string {
  return `${vestingBaseToString(node.base)}${offsetsToString(node.offsets)}${node.condition ? ` ${conditionToString(node.condition)}` : ""}`;
}

function blockerConditionToString(c: Omit<VestingNode, "type">): string {
  return `${vestingNodeToString({ ...c, type: "NODE" })}`;
}

function conditionToString(c: Condition): string {
  switch (c.type) {
    case "ATOM":
      return constraintToString(c.constraint);
    case "AND":
    case "OR": {
      const items = c.items.map(conditionToString);
      return `${c.type} ( ${items.join(", ")} )`;
    }
  }
}

function durationToString(d: Duration): string {
  const sign = d.sign === "MINUS" ? "-" : "+";
  return `${sign}${d.value} ${d.unit.toLowerCase()}`;
}

function constraintToString(c: Constraint): string {
  const strict = c.strict ? "STRICTLY " : "";
  return `${strict}${c.type} ${vestingNodeToString(c.base)}`;
}

function offsetsToString(o: Offsets): string {
  if (o.length === 0) return "";
  return ` ${o.map(durationToString).join(" ")}`;
}

function vestingBaseToString(b: VestingBase): string {
  switch (b.type) {
    case "DATE":
      return `DATE ${b.value}`;
    case "EVENT":
      return `EVENT ${b.value}`;
    // System anchors keep the `EVENT <name>` rendering they had when they lived
    // in the EVENT arm, so diagnostic strings are unchanged.
    case "GRANT_DATE":
      return "EVENT grantDate";
    case "VESTING_START":
      return "EVENT vestingStart";
  }
}
