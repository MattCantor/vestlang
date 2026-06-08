import type { PipelineError } from "@vestlang/pipeline";
import { readFileSync } from "node:fs";

function readAllStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

export function input(parts: string[], stdin?: boolean): string {
  return stdin ? readAllStdin() : parts.join(" ");
}

// Print a pipeline error as one clean `error:` line — with the source location
// when it's a syntax error — and exit non-zero. This is what keeps a bad input
// from surfacing as a raw Node stack trace with internal file paths.
export function fail(error: PipelineError): never {
  const where =
    error.ruleId === "syntax-error" && error.loc
      ? ` (${error.loc.start.line}:${error.loc.start.column})`
      : "";
  console.error(`error: ${error.message}${where}`);
  process.exit(1);
}
