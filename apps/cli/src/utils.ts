import type { PipelineError } from "@vestlang/pipeline";
import { isValidCalendarDate } from "@vestlang/utils";
import { InvalidArgumentError } from "commander";
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

/**
 * Collect repeated --event NAME=YYYY-MM-DD into a { name: date } record
 * (last write wins on a duplicate name). The shape regex only guards the
 * layout, so the matched date still goes through `isValidCalendarDate` — the
 * same guard grant/as-of dates use — to reject impossibles like 2025-02-31
 * that the engine would otherwise silently roll over.
 */
export function parseEvent(
  value: string,
  prev: Record<string, string> = {},
): Record<string, string> {
  const m = /^([^=]+)=(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (!m) {
    throw new InvalidArgumentError(
      "Invalid --event. Use NAME=YYYY-MM-DD (e.g., --event milestone=2025-01-01)",
    );
  }
  const [, name, date] = m;
  if (!isValidCalendarDate(date)) {
    throw new InvalidArgumentError(
      `"${date}" is not a valid calendar date. Use YYYY-MM-DD.`,
    );
  }
  return { ...prev, [name]: date };
}
