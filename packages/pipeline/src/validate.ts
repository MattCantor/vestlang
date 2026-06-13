// Scalar checks the CLI runs on its flag values before handing them to a run*
// entry point. They return a Result rather than printing and exiting, so the
// CLI's single error boundary can present the failure the same way it presents
// every other one. (The MCP server validates the same things through zod at its
// own boundary — same rules, different mechanism.)

import { isValidCalendarDate } from "@vestlang/utils";
import type { OCTDate } from "@vestlang/types";
import type { Result } from "./parse.js";

// A bad flag value isn't a DSL syntax error and isn't an engine throw, so it
// rides the plain-message arm of PipelineError.
export function parseQuantity(raw: string): Result<{ quantity: number }> {
  const quantity = Number(raw);
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    return {
      ok: false,
      error: {
        ruleId: "evaluation-error",
        message: `Quantity must be a non-negative whole number (at most ${Number.MAX_SAFE_INTEGER}).`,
      },
    };
  }
  return { ok: true, quantity };
}

export function validateDate(raw: string): Result<{ date: OCTDate }> {
  if (!isValidCalendarDate(raw)) {
    return {
      ok: false,
      error: {
        ruleId: "evaluation-error",
        message: `"${raw}" is not a valid calendar date. Use YYYY-MM-DD.`,
      },
    };
  }
  return { ok: true, date: raw };
}
