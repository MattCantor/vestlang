import {
  ExprEnum,
  TwoOrMore,
  AnyASTExpr,
  ASTSchedule,
  LaterOfASTExpr,
  EarlierOfASTExpr,
} from "@vestlang/dsl";
import { normalizeSchedule, VestlangScheduleExpression } from "./schedule.js";
import { isTwoOrMore } from "../types/raw-ast-guards.js";
import { invariant, unexpectedAst } from "../errors.js";
import { VestlangExpression } from "../types/shared.js";

/* ------------------------
 * Types
 * ------------------------ */

// types/vestlang/VestlangLaterOfExpression
export interface VestlangEarlierOfExpression extends VestlangExpression {
  type: ExprEnum.EARLIER_OF;
  items: TwoOrMore<VestlangExpression>;
}

// types/vestlang/VestlangLaterOfExpression
export interface VestlangLaterOfExpression extends VestlangExpression {
  type: ExprEnum.LATER_OF;
  items: TwoOrMore<VestlangExpression>;
}

/* ------------------------
 * Expression
 * ------------------------ */

export function normalizeExpr(
  ast: AnyASTExpr,
  path: string[] = [],
): VestlangExpression {
  switch (ast.type) {
    case ExprEnum.SINGLETON: {
      const schedule = ast as ASTSchedule;
      return normalizeSchedule(schedule, [...path, "SINGLETON"]);
    }

    case ExprEnum.LATER_OF: {
      const later = ast as LaterOfASTExpr;
      const items = later.items.map((e, i) =>
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
        type: ExprEnum.LATER_OF,
        items: items as TwoOrMore<
          | VestlangScheduleExpression
          | VestlangEarlierOfExpression
          | VestlangLaterOfExpression
        >,
      } as VestlangLaterOfExpression;
    }

    case ExprEnum.EARLIER_OF: {
      const earlier = ast as EarlierOfASTExpr;
      const items = earlier.items.map((e, i) =>
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
        type: ExprEnum.EARLIER_OF,
        items: items as TwoOrMore<
          | VestlangScheduleExpression
          | VestlangEarlierOfExpression
          | VestlangLaterOfExpression
        >,
      } as VestlangEarlierOfExpression;
    }
    default:
      return unexpectedAst("Unknown ASTExpr variant", { ast }, path);
  }
}
