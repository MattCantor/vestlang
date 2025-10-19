import { Doc } from "prettier";
import { indent, line, join } from "../builders.js";

export function printParenGroup(keyword: Doc, items: Doc[]): Doc {
  return [keyword, "(", indent([line, join([",", line], items)]), line, ")"];
}
