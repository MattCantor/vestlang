import { ASTExpr } from "@vestlang/dsl";

/* ---------------
 * ASTSchedule
 * -------------- */

function countLeafSchedules(expr: ASTExpr): number {
  switch (expr.type) {
    case "Schedule":
      return 1;
    case "EarlierOfSchedules":
    case "LaterOfSchedules":
      return expr.items.reduce((n, it) => n + countLeafSchedules(it), 0);
  }
}
