/* ------------------------
 * Public API
 * ------------------------ */

import { ASTExpr, ASTStatement } from "@vestlang/dsl";
import {
  EarlierOfSchedules,
  Expr,
  LaterOfSchedules,
  Statement,
} from "../types/normalized.js";
import { invariant, unexpectedAst } from "../errors.js";
import {
  isEarlierOfSchedules,
  isLaterOfSchedules,
  isSchedule,
  isTwoOrMore,
} from "../types/raw-ast-guards.js";
import { ExprType, TwoOrMore } from "../types/shared.js";
import { normalizeAmount } from "./amount.js";
import { normalizeSchedule } from "./schedule.js";

export function normalizeStatement(ast: ASTStatement): Statement {
  const expr = normalizeExpr(ast.expr, ["expr"]);
  const amount = normalizeAmount(ast.amount, ["amount"]);
  return {
    id: "",
    amount,
    expr,
  };
}

export function normalizeExpr(ast: ASTExpr, path: string[] = []): Expr {
  if (isSchedule(ast)) {
    return normalizeSchedule(ast, [...path, "Schedule"]);
  }

  if (isLaterOfSchedules(ast)) {
    const items = ast.items.map((e, i) =>
      normalizeExpr(e, [...path, `items[${i}]`]),
    );
    invariant(
      isTwoOrMore(items),
      "LaterOfSchedules requires >= 2 items",
      { items },
      path,
    );
    return {
      id: "",
      type: "LaterOfSchedules" as ExprType,
      items: items as TwoOrMore<Expr>,
    } as LaterOfSchedules;
  }

  if (isEarlierOfSchedules(ast)) {
    const items = ast.items.map((e, i) =>
      normalizeExpr(e, [...path, `items[${i}]`]),
    );
    invariant(
      isTwoOrMore(items),
      "EarlierOfSchedules requires >= 2 items",
      { items },
      path,
    );
    return {
      id: "",
      type: "EarlierOfSchedules" as ExprType,
      items: items as TwoOrMore<Expr>,
    } as EarlierOfSchedules;
  }
  return unexpectedAst("Unknown ASTExpr variant", { ast }, path);
}
