/**
 * A tiny, prettier-free layout IR.
 *
 * `toDoc` builds one of these from the AST; `printFlat` collapses it to the
 * canonical one-line string, and the prettier plugin maps it onto prettier's
 * own `doc.builders` for width-aware output. Keeping the IR here (rather than
 * importing prettier's `Doc`) is what keeps prettier off the dependency graph
 * of every package that only ever wants the flat string.
 *
 * There is deliberately no `hardline`: every break is an adaptive `line`/
 * `softline` inside a `group`, so the flat print can never be forced to wrap.
 */
export type Doc =
  | string
  | Doc[]
  | { kind: "group"; contents: Doc }
  | { kind: "indent"; contents: Doc }
  | { kind: "line" }
  | { kind: "softline" };

export function group(contents: Doc): Doc {
  return { kind: "group", contents };
}

export function indent(contents: Doc): Doc {
  return { kind: "indent", contents };
}

/** A space when flat, a newline when its group breaks. */
export const line: Doc = { kind: "line" };

/** Nothing when flat, a newline when its group breaks. */
export const softline: Doc = { kind: "softline" };

/** Intersperse `sep` between `items`. */
export function join(sep: Doc, items: Doc[]): Doc {
  const out: Doc[] = [];
  items.forEach((item, i) => {
    if (i > 0) out.push(sep);
    out.push(item);
  });
  return out;
}
