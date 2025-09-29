import type { Parser } from "prettier";
import type { ParseResult } from "./types";

import { parse as vestParse } from "@vestlang/dsl";

export const parser: Parser = {
  parse(text: string): ParseResult {
    const stmt = vestParse(text);
    return { type: "Program", body: [stmt] };
  },
  astFormat: "vestlang-ast",
  locStart: () => 0,
  locEnd: () => 0,
};
