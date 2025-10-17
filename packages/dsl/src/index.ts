import * as parser from "./generated/grammar.js";
export type * from "./generated/grammar.d.js";

import type { Program } from "@vestlang/types";

export function parse(input: string): Program {
  const stmt = parser.parse(input) as Program;
  return stmt;
}
