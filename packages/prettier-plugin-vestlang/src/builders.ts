import type { Doc } from "prettier";
import { doc } from "prettier";

const { builders } = doc;
export const { group, indent, softline, line, hardline, join, ifBreak } =
  builders;

export function wrapParen(d: Doc): Doc {
  return group(["(", indent([softline, d]), softline, ")"]);
}

export function listWithCommas(items: Doc[]): Doc {
  return join([",", line], items);
}

export function kw(s: string): Doc {
  return s.toUpperCase();
}
