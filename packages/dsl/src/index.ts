import * as t from "./types.js";
import * as parser from "../dist/grammar.js";

export type { t };

export function parse(input: string): t.Statement {
  const stmt = parser.parse(input) as t.Statement;
  return stmt;
}
