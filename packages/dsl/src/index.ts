import * as parser from "./generated/grammar.js";
export type * from "./generated/grammar.d.js";

import type * as t from "./types.js";
export type * from "./types.js";
export * from "./enums.js";

export function parse(input: string): t.ASTStatement {
  const stmt = parser.parse(input) as t.ASTStatement;
  return stmt;
}
