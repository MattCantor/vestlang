// Structural + runtime validation for the canonical vesting IR.
//
// The template structure is no longer hand-checked here: the shape and its rules
// live once in `@vestlang/primitives`' shared Zod schema, which the MCP server's
// persisted-artifact validator parses against too. This file parses a template
// against that schema and maps the result back to the `{ valid, errors[] }`
// shape consumers expect — zod stays an implementation detail behind that surface.
// The runtime validator is a different shape (it cross-checks against the
// template) and stays hand-rolled here.

import type { VestingRuntime, VestingScheduleTemplate } from "@vestlang/types";
import { isValidCalendarDate } from "@vestlang/utils";
import { TEMPLATE, zodIssuesToValidationErrors } from "@vestlang/primitives";

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Structural validation for a canonical VestingScheduleTemplate. Returns a
 * { valid, errors[] } result that consumers (the compiler, the OCF validator)
 * can use to either bail or map into their own report shape. Schema-only:
 * checks the spec's well-formedness, not runtime inputs.
 */
export const validateVestingScheduleTemplate = (
  t: VestingScheduleTemplate,
): ValidationResult => {
  const result = TEMPLATE.safeParse(t);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  const errors = zodIssuesToValidationErrors(result.error.issues, t);
  return { valid: false, errors };
};

/**
 * Validates the per-grant runtime data passed to the compiler against the
 * template. Catches mismatches that the static template validator cannot:
 *   - startDate required when the template has any statement (all DATE-anchored);
 *     a contingent start's CONTINGENT_START_SENTINEL is a real calendar date, so
 *     it passes the format check and the compiler's sentinel-skip handles it.
 *   - no duplicate event_id in eventFirings (single firing per event_id)
 *   - dates must be real calendar dates (2025-02-31 is rejected, not rolled)
 *
 * eventFirings is the event-hold witness channel: a firing here releases the grid
 * of any statement whose `event_condition.event_id` matches. The entries are
 * shape-checked, but deliberately NOT cross-checked against the template's
 * event_conditions in either direction — an unfired condition (no matching firing)
 * is the valid held state, and an unreferenced firing is harmless. That symmetry
 * (no orphan rejection) is the rule that, if broken, would fail every held grant.
 */
export const validateVestingRuntime = (
  runtime: VestingRuntime,
  template: VestingScheduleTemplate,
): ValidationResult => {
  const errors: ValidationError[] = [];

  // Every canonical statement is DATE-anchored, so a non-empty template needs a
  // startDate. (A contingent placeholder carries the sentinel here, which is a
  // valid calendar date.)
  const hasStatements =
    Array.isArray(template.statements) && template.statements.length > 0;

  if (hasStatements) {
    if (typeof runtime.startDate !== "string") {
      errors.push({
        path: "startDate",
        message: "is required when the template contains any statement",
      });
    } else if (!isValidCalendarDate(runtime.startDate)) {
      errors.push({
        path: "startDate",
        message: "must be a real calendar date (YYYY-MM-DD)",
      });
    }
  } else if (
    runtime.startDate !== undefined &&
    !isValidCalendarDate(runtime.startDate)
  ) {
    // Tolerated but format-checked.
    errors.push({
      path: "startDate",
      message: "must be a real calendar date (YYYY-MM-DD)",
    });
  }

  if (runtime.grantDate !== undefined) {
    if (
      typeof runtime.grantDate !== "string" ||
      !isValidCalendarDate(runtime.grantDate)
    ) {
      errors.push({
        path: "grantDate",
        message: "must be a real calendar date (YYYY-MM-DD)",
      });
    }
  }

  if (runtime.eventFirings !== undefined) {
    if (!Array.isArray(runtime.eventFirings)) {
      errors.push({ path: "eventFirings", message: "must be an array" });
    } else {
      const seen = new Map<string, number[]>();

      runtime.eventFirings.forEach((firing, i) => {
        const path = `eventFirings[${i}]`;
        if (
          typeof firing?.event_id !== "string" ||
          firing.event_id.length === 0
        ) {
          errors.push({
            path: `${path}.event_id`,
            message: "must be a non-empty string",
          });
        } else {
          const indices = seen.get(firing.event_id) ?? [];
          indices.push(i);
          seen.set(firing.event_id, indices);
        }
        if (
          typeof firing?.date !== "string" ||
          !isValidCalendarDate(firing.date)
        ) {
          errors.push({
            path: `${path}.date`,
            message: "must be a real calendar date (YYYY-MM-DD)",
          });
        }
      });

      for (const [eventId, indices] of seen) {
        if (indices.length > 1) {
          errors.push({
            path: "eventFirings",
            message: `duplicate event_id "${eventId}" at indices [${indices.join(", ")}]`,
          });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
};

const formatErrors = (errors: ValidationError[]): string =>
  errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");

/** Throws a single Error with all validation messages on invalid input. */
export const assertValidVestingScheduleTemplate = (
  t: VestingScheduleTemplate,
): void => {
  const result = validateVestingScheduleTemplate(t);
  if (!result.valid) {
    throw new Error(
      `Invalid VestingScheduleTemplate:\n${formatErrors(result.errors)}`,
    );
  }
};

/** Throws a single Error with all validation messages on invalid input. */
export const assertValidVestingRuntime = (
  runtime: VestingRuntime,
  template: VestingScheduleTemplate,
): void => {
  const result = validateVestingRuntime(runtime, template);
  if (!result.valid) {
    throw new Error(`Invalid VestingRuntime:\n${formatErrors(result.errors)}`);
  }
};
