import type { Doc } from "prettier";
import { doc } from "prettier";

const { builders } = doc;
export const { group, indent, softline, line, hardline, join } = builders;

export function kw(s: string): Doc {
  return s.toUpperCase();
}
