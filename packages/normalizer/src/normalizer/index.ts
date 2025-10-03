import type { ASTStatement } from "@vestlang/dsl";
import { type Amount, normalizeAmount } from "./amount.js";
import { Expr, normalizeExpr } from "./expression.js";

/* ------------------------
 * Types
 * ------------------------ */

interface Statement {
  id: string;
  amount: Amount;
  expr: Expr;
}

/* ------------------------
 * Public API
 * ------------------------ */

export function normalizeStatement(ast: ASTStatement): Statement {
  const expr = normalizeExpr(ast.expr, ["expr"]);
  const amount = normalizeAmount(ast.amount, ["amount"]);
  return {
    id: "",
    amount,
    expr,
  };
}

export { normalizeExpr } from "./expression.js";
