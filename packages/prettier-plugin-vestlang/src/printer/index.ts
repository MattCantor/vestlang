import { RawProgram, RawScheduleExpr, RawStatement } from "@vestlang/types";
import { AstPath, Doc, Printer } from "prettier";
import { printStatement } from "./program.js";
import { group, hardline, indent, join, softline } from "../builders.js";

export const printer: Printer = {
  print(path: AstPath): Doc {
    const node = path.node as RawStatement | RawStatement[];

    if (Array.isArray(node)) {
      // Program = Statement[]
      if (node.length === 0) return "";

      // const docs = node.map((s) => printStatement(s));
      // return [join(hardline, docs), hardline];
      if (node.length === 1) return [printStatement(node[0]), hardline];
      const docs = node.map((s) => printStatement(s));
      return group([
        "[",
        indent([softline, join([",", hardline], docs)]),
        ",",
        softline,
        "]",
        hardline,
      ]);
    }

    return "";
  },
};
