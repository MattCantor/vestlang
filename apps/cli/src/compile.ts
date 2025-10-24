import { parse } from "@vestlang/dsl";
import { input } from "./utils.js";
import { normalizeProgram } from "@vestlang/normalizer";

export function compile(parts: string[] = [], opts: { stdin?: boolean }): void {
  const ast = parse(input(parts, opts.stdin));
  const result = normalizeProgram(ast);
  console.log(JSON.stringify(result, null, 2));
}
