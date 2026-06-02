import type { Program, Statement } from "@vestlang/types";
import { AstPath, Doc as PrettierDoc, doc, Printer } from "prettier";
import { toDoc, type Doc } from "@vestlang/render";

const { group, indent, line, softline, ifBreak, hardline } = doc.builders;

/**
 * Map the renderer's prettier-free Doc IR onto prettier's own `doc.builders`.
 * The renderer owns the traversal and the layout; this boundary just hands the
 * result to prettier's pipeline so it measures against the user's printWidth.
 */
function toPrettier(d: Doc): PrettierDoc {
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map(toPrettier);
  switch (d.kind) {
    case "group":
      return group(toPrettier(d.contents));
    case "indent":
      return indent(toPrettier(d.contents));
    case "line":
      return line;
    case "softline":
      return softline;
    case "ifBreak":
      return ifBreak(toPrettier(d.broken), toPrettier(d.flat));
  }
}

export const printer: Printer = {
  print(path: AstPath): PrettierDoc {
    const node = path.node as Statement | Program;
    // The trailing newline is a formatter convention and lives only here — the
    // IR stays hardline-free so the flat (stringify) path can't be forced to
    // wrap. Width-aware breaking is driven by prettier's built-in printWidth.
    return [toPrettier(toDoc(node)), hardline];
  },
};
