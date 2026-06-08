import { parseToProgram } from "@vestlang/pipeline";
import { input, fail } from "./utils.js";

export function compile(parts: string[] = [], opts: { stdin?: boolean }): void {
  const result = parseToProgram(input(parts, opts.stdin));
  if (!result.ok) fail(result.error);
  console.log(JSON.stringify(result.program, null, 2));
}
