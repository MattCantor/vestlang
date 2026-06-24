// Structural + runtime validation for the canonical vesting IR.
//
// The template structure is no longer hand-checked here: the shape and its rules
// live once in `@vestlang/primitives`' shared Zod schema, which the MCP server's
// persisted-artifact validator parses against too. This file parses a template
// against that schema and maps the result back to the `{ valid, errors[] }`
// shape consumers expect — zod stays an implementation detail behind that surface.
// The runtime validator is a different shape (it cross-checks against the
// template) and stays hand-rolled here.

import type {
  Finding,
  VestingRuntime,
  VestingScheduleTemplate,
} from "@vestlang/types";
import { isValidCalendarDate } from "@vestlang/utils";
import { TEMPLATE, zodIssuesToValidationErrors } from "@vestlang/primitives";

import { templateAllocationFindings } from "./findings";

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * The combined verdict from `validateTemplateAllocatable`: the structural
 * `errors` and the allocation `findings` side by side, plus a single `valid`
 * that already folds both in. Reuses the existing `ValidationError` and the
 * shared `Finding` rather than minting parallel shapes.
 */
export interface AllocatableValidationResult {
  valid: boolean;
  errors: ValidationError[];
  findings: Finding[];
}

/**
 * Structural validation for a canonical VestingScheduleTemplate. Returns a
 * { valid, errors[] } result that consumers (the compiler, the OCF validator)
 * can use to either bail or map into their own report shape. Schema-only:
 * checks the spec's well-formedness, not runtime inputs.
 *
 * Heads-up: a structurally valid template can still allocate more than 100% of
 * the grant. The `SHARE_OF_GRANT` percentage deliberately carries no upper
 * bound (it tracks OCF's unbounded `Numeric`), so two statements summing to
 * 150% pass here with `valid: true`. Over-allocation is a *separate* check —
 * `templateAllocationFindings`, or the combined `validateTemplateAllocatable`
 * that runs both passes. Reading this `valid` as "safe to allocate" is a real
 * foot-gun: it doesn't bound the share. When you need an allocatability verdict,
 * call `validateTemplateAllocatable`.
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
 * Structure *and* allocatability in one verdict — the function to call when
 * `valid` needs to mean "safe to allocate," which the structural validator's
 * `valid` does not (see its note). Runs `validateVestingScheduleTemplate` for
 * the shape, then `templateAllocationFindings` for the over/under-allocation
 * sum, and combines them:
 *   - `errors`   — the structural ValidationError[].
 *   - `findings` — the allocation Finding[] (over-allocation = error,
 *                  under-allocation = warning, none at 100% or 0 shares).
 *   - `valid`    — structurally valid AND no error-severity finding. We key on
 *                  `severity === "error"`, not on `kind === "over-allocation"`,
 *                  so any future error-level finding blocks without an
 *                  enumeration change. (This is pipeline's `errorFindings`
 *                  rationale; it can't be imported here — pipeline depends on
 *                  core — so the one-line filter is reimplemented inline.) An
 *                  over-allocation flips `valid` false; an under-allocation, a
 *                  legal warning, leaves it true.
 *
 * Advisory, not throwing — the over-allocation surfaces as a finding, so a
 * caller decides what to do with it.
 *
 * Throw-guard: `templateAllocationFindings` parses each percentage with the
 * *throwing* `numericToFraction`, which throws on a malformed or oversized
 * (past MAX_SAFE) Numeric, and whose `.map` throws on a non-array `statements`.
 * Those are exactly the structurally-invalid inputs: `SHARE_OF_GRANT` accepts a
 * percentage iff the non-throwing parse succeeds, so a structurally *valid*
 * template can never make the throwing parse throw. We therefore short-circuit
 * on structural invalidity — return early with `findings: []`, letting the
 * structural errors carry the verdict — and never run the findings pass on an
 * input that could throw.
 */
export const validateTemplateAllocatable = (
  template: VestingScheduleTemplate,
  totalShares: number,
): AllocatableValidationResult => {
  const structural = validateVestingScheduleTemplate(template);
  if (!structural.valid) {
    // Invalid shape is the only input that makes templateAllocationFindings
    // throw (oversized/malformed percentage, non-array statements), so skip it
    // entirely — the structural errors already carry the verdict.
    return { valid: false, errors: structural.errors, findings: [] };
  }

  const findings = templateAllocationFindings(template, totalShares);
  const hasError = findings.some((f) => f.severity === "error");
  return { valid: !hasError, errors: structural.errors, findings };
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

/**
 * Throws a single Error with all validation messages on invalid input.
 *
 * Same caveat as `validateVestingScheduleTemplate`: this asserts *structure*
 * only. It does not throw on an over-allocating template — two statements
 * summing to 150% pass this assertion. Allocatability is `templateAllocationFindings`
 * / `validateTemplateAllocatable`, not the structural assert.
 */
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
