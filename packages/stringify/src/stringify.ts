import type { Program, Statement } from "@vestlang/types";
import { stringifyStatement } from "./statement.js";

/**
 * Stringify a Program (array of statements).
 * Single statements are output directly, multiple statements use list syntax.
 */
export function stringifyProgram(p: Program): string {
  if (p.length === 0) return "";
  if (p.length === 1) return stringifyStatement(p[0]);
  // Multiple statements use list syntax: [ stmt1, stmt2, ... ]
  return `[ ${p.map(stringifyStatement).join(", ")} ]`;
}

/**
 * Stringify a normalized AST node (Statement or Program).
 */
export function stringify(node: Statement | Program): string {
  if (Array.isArray(node)) {
    return stringifyProgram(node);
  }
  return stringifyStatement(node);
}
