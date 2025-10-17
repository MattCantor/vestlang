import type { Parser, ParserOptions } from "prettier";

import { parse as vestParse } from "@vestlang/dsl";

export const parser: Parser = {
  parse(text: string) {
    return vestParse(text);
  },
  astFormat: "vestlang-ast",
  locStart: () => 0,
  locEnd: () => 0,
};

export default parser;
