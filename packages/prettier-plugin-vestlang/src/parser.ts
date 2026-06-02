import type { Parser } from "prettier";

import { parse as vestParse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";

export const parser: Parser = {
  // `toDoc` is defined over the normalized AST (vesting starts resolved to
  // nodes, cliffs to VestingNodeExpr), and the sugar collapse keys off those
  // normalized shapes — so normalize here before handing the tree to the
  // printer.
  parse(text: string) {
    return normalizeProgram(vestParse(text));
  },
  astFormat: "vestlang-ast",
  locStart: () => 0,
  locEnd: () => 0,
};
