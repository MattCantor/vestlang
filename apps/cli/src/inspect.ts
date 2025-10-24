import { parse } from "@vestlang/dsl";
import { input } from "./utils.js";

export function inspect(parts: string[] = [], opts: { stdin?: boolean }): void {
  const ast = parse(input(parts, opts.stdin));
  console.log(JSON.stringify(ast, null, 2));
}
