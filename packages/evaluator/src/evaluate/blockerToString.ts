import { Blocker } from "@vestlang/types";
import { stringifyVestingNodeExpr } from "@vestlang/render";
import { foldBlocker } from "./blockerTree.js";

export function blockerToString(b: Blocker): string {
  return foldBlocker(b, (node, items) => {
    switch (node.type) {
      case "EVENT_NOT_YET_OCCURRED":
        return `EVENT ${node.event}`;
      case "UNRESOLVED_CONDITION":
      case "IMPOSSIBLE_CONDITION":
        return stringifyVestingNodeExpr(node.node);
      case "UNRESOLVED_SELECTOR":
      case "IMPOSSIBLE_SELECTOR":
        return node.selector === "EARLIER_OF"
          ? `EARLIER OF ( ${items.join(", ")} )`
          : `LATER OF ( ${items.join(", ")} )`;
    }
  });
}
