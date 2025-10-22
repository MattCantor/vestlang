import * as parser from "./generated/grammar.js";
export type * from "./generated/grammar.d.js";

import type { RawProgram } from "@vestlang/types";

export function parse(input: string): RawProgram {
  return parser.parse(input) as RawProgram;
}
