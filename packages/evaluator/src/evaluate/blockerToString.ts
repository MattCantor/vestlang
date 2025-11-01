import {
  Condition,
  VestingNode,
  Duration,
  Blocker,
  Constraint,
  Offsets,
  VestingBase,
} from "@vestlang/types";

export function blockerToString(b: Blocker): string {
  switch (b.type) {
    case "EVENT_NOT_YET_OCCURRED":
      return `EVENT ${b.event}`;
    case "DATE_NOT_YET_OCCURRED":
      return `DATE ${b.date}`;
    case "UNRESOLVED_CONDITION":
    case "IMPOSSIBLE_CONDITION":
      return blockerConditionToString(b.condition);
    case "UNRESOLVED_SELECTOR":
    case "IMPOSSIBLE_SELECTOR":
      switch (b.selector) {
        case "EARLIER_OF":
          const EarlierOfItems = b.blockers.map(blockerToString).join(", ");
          return `EARLIER OF ( ${EarlierOfItems} )`;
        case "LATER_OF":
          const LaterOfItems = b.blockers.map(blockerToString).join(", ");
          return `LATER OF ( ${LaterOfItems} )`;
      }
  }
}

function vestingNodeToString(node: VestingNode): string {
  return `${vestingBaseToString(node.base)}${offsetsToString(node.offsets)}${node.constraints ? ` ${conditionToString(node.constraints)}` : ""}`;
}

function blockerConditionToString(c: Omit<VestingNode, "type">): string {
  return `${vestingNodeToString({ ...c, type: "SINGLETON" })}`;
}

function conditionToString(c: Condition): string {
  switch (c.type) {
    case "ATOM":
      return constraintToString(c.constraint);
    case "AND":
    case "OR":
      const items = c.items.map(conditionToString);
      return `${c.type} ( ${items} )`;
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
  return `${b.type} ${b.value}`;
}
