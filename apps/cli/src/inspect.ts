import { parseRaw } from "@vestlang/pipeline";
import { input, fail } from "./utils.js";

export function inspect(parts: string[] = [], opts: { stdin?: boolean }): void {
  const result = parseRaw(input(parts, opts.stdin));
  if (!result.ok) fail(result.error);
  console.log(JSON.stringify(result.ast, null, 2));
}
