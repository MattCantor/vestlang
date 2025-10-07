import { ASTExpr, TwoOrMore } from "@vestlang/dsl";
import { BaseExpr, ExprType } from "../types/shared.js";
import { normalizeSchedule, Schedule } from "./schedule.js";
import {
  isEarlierOfASTExpr,
  isLaterOfASTExpr,
  isSchedule,
  isTwoOrMore,
} from "../types/raw-ast-guards.js";
import { invariant, unexpectedAst } from "../errors.js";

/* ------------------------
 * Types
 * ------------------------ */

interface BaseScheduleCombinator extends BaseExpr {
  items: TwoOrMore<Expr>;
}

export interface LaterOfSchedules extends BaseScheduleCombinator {
  type: "LaterOf";
}

export interface EarlierOfSchedules extends BaseScheduleCombinator {
  type: "EarlierOf";
}

type ScheduleCombinator = LaterOfSchedules | EarlierOfSchedules;

export type Expr = Schedule | ScheduleCombinator;

/* ------------------------
 * Expression
 * ------------------------ */

export function normalizeExpr(ast: ASTExpr, path: string[] = []): Expr {
  if (isSchedule(ast)) {
    return normalizeSchedule(ast, [...path, "Schedule"]);
  }

  if (isLaterOfASTExpr(ast)) {
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
      type: "LaterOf" as ExprType,
      items: items as TwoOrMore<Expr>,
    } as LaterOfSchedules;
  }

  if (isEarlierOfASTExpr(ast)) {
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
      type: "EarlierOf" as ExprType,
      items: items as TwoOrMore<Expr>,
    } as EarlierOfSchedules;
  }
  return unexpectedAst("Unknown ASTExpr variant", { ast }, path);
}
