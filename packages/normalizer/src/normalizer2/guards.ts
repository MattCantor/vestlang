import { EarlierOfASTExpr, LaterOfASTExpr, VestingNode } from "@vestlang/dsl";

/** Type guard for vesting nodes */
export function isVestingNode(x: any): x is VestingNode {
  return (
    !!x &&
    typeof x === "object" &&
    (x.type === "BARE" || x.type === "CONSTRAINED")
  );
}

/** Type guard for selectors (EARLIER_OF/LATER_OF) */
export function isSelector(x: any): x is EarlierOfASTExpr | LaterOfASTExpr {
  return (
    !!x &&
    typeof x === "object" &&
    (x.type === "LATER_OF" || x.type === "EARLIER_OF")
  );
}
