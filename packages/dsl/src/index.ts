import * as t from "./types.js";
// @ts-expect-error - generated at build time
import * as grammar from "./grammar.js";

export type { t };

export function parse(input: string): t.Statement {
  const stmt = grammar.parse(input) as t.Statement;
  return stmt;
}
