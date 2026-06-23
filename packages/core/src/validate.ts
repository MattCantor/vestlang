// Structural + runtime validation for the canonical vesting IR.

import type {
  Cliff,
  Fraction,
  PeriodType,
  VestingRuntime,
  VestingScheduleTemplate,
  VestingStatement,
} from "@vestlang/types";
import {
  isNumeric,
  isValidCalendarDate,
  numericToFraction,
} from "@vestlang/utils";
import { installmentCapMessage, MAX_INSTALLMENTS } from "@vestlang/primitives";

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const PERIOD_TYPES: ReadonlyArray<PeriodType> = ["DAYS", "MONTHS", "YEARS"];

const isInteger = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n);

const isPositiveInt = (n: unknown): n is number => isInteger(n) && n > 0;

const isNonNegativeInt = (n: unknown): n is number => isInteger(n) && n >= 0;

const validateFraction = (
  f: Fraction,
  path: string,
  errors: ValidationError[],
): void => {
  if (!isInteger(f.numerator)) {
    errors.push({ path: `${path}.numerator`, message: "must be an integer" });
  }
  if (!isPositiveInt(f.denominator)) {
    errors.push({
      path: `${path}.denominator`,
      message: "must be an integer >= 1",
    });
  }
};

const validateCliff = (
  c: Cliff,
  path: string,
  errors: ValidationError[],
): void => {
  if (!isNonNegativeInt(c.length)) {
    errors.push({
      path: `${path}.length`,
      message: "must be an integer >= 0",
    });
  }
  if (!PERIOD_TYPES.includes(c.period_type)) {
    errors.push({
      path: `${path}.period_type`,
      message: `must be one of ${PERIOD_TYPES.join(", ")}`,
    });
  }
  // percentage is stored as an OCF Numeric decimal and is a share of the
  // statement, so once it parses it must lie in [0, 1]. Shape-check the string
  // first; only then parse and bound-check the value.
  if (!isNumeric(c.percentage)) {
    errors.push({
      path: `${path}.percentage`,
      message: "must be an OCF Numeric string",
    });
  } else if (!numericInUnitInterval(c.percentage)) {
    errors.push({
      path: `${path}.percentage`,
      message: "must be in the closed interval [0, 1]",
    });
  }
};

const validateVestingBase = (
  base: VestingStatement["vesting_base"],
  path: string,
  errors: ValidationError[],
): void => {
  if (!base || typeof base !== "object") {
    errors.push({ path, message: "is required and must be an object" });
    return;
  }
  // The canonical base is DATE-only: every statement anchors on the one hoisted
  // per-grant start (a contingent start is a DATE base on the sentinel). An EVENT
  // base — or any other type — has no home, so it's rejected. Read `type`
  // structurally: the input is untrusted (hand-built / foreign artifacts), so it
  // can carry a value the static type says is impossible.
  const baseType = (base as { type?: unknown }).type;
  if (baseType !== "DATE") {
    errors.push({
      path: `${path}.type`,
      message: 'must be "DATE"',
    });
    return;
  }
  // No extra fields permitted; specifically, a stray event_id is wrong.
  if ("event_id" in base) {
    errors.push({
      path: `${path}.event_id`,
      message: 'must not be present on a vesting_base with type "DATE"',
    });
  }
};

const validateStatement = (
  s: VestingStatement,
  path: string,
  errors: ValidationError[],
): void => {
  if (!isPositiveInt(s.order)) {
    errors.push({ path: `${path}.order`, message: "must be an integer >= 1" });
  }
  validateVestingBase(s.vesting_base, `${path}.vesting_base`, errors);
  if (!isPositiveInt(s.occurrences)) {
    errors.push({
      path: `${path}.occurrences`,
      message: "must be an integer >= 1",
    });
  }
  if (!isNonNegativeInt(s.period)) {
    errors.push({
      path: `${path}.period`,
      message: "must be an integer >= 0",
    });
  }
  if (!PERIOD_TYPES.includes(s.period_type)) {
    errors.push({
      path: `${path}.period_type`,
      message: `must be one of ${PERIOD_TYPES.join(", ")}`,
    });
  }
  // The statement's share of the grant, stored as an OCF Numeric decimal. A
  // negative share is never meaningful — it makes the allocator emit negative
  // installments — so reject it here. Over 1 is *not* rejected: the evaluator
  // represents an over-allocating clause as a statement whose percentage exceeds
  // 1 and surfaces it as an over-allocation finding rather than a hard error, so
  // the upper bound stays a finding's job, not the validator's.
  if (!isNumeric(s.percentage)) {
    errors.push({
      path: `${path}.percentage`,
      message: "must be an OCF Numeric string",
    });
  } else if (numericToFraction(s.percentage).numerator < 0) {
    errors.push({
      path: `${path}.percentage`,
      message: "must be >= 0",
    });
  }
  if (s.cliff) {
    validateCliff(s.cliff, `${path}.cliff`, errors);
  }
  // The event hold: a shape check only. `event_id` must be a non-empty string —
  // that's all this layer can know. An unfired event_condition (no matching firing
  // in the runtime) is VALID, the held state; we never cross-check the firing here,
  // in either direction. Real-vs-synthetic id membership isn't this validator's job
  // (it sees only template + runtime, no sidecar/world): a synthetic id's backing
  // is the save-path dangling-pointer check, and a bare real id simply resolves
  // against the world (unresolved = held, not an error).
  if (s.event_condition !== undefined) {
    const ec = s.event_condition as { event_id?: unknown };
    if (typeof ec.event_id !== "string" || ec.event_id.length === 0) {
      errors.push({
        path: `${path}.event_condition.event_id`,
        message: "must be a non-empty string",
      });
    }
  }
};

/**
 * Structural validation for a canonical VestingScheduleTemplate. Returns a
 * { valid, errors[] } result that consumers (the compiler, the OCF validator)
 * can use to either bail or map into their own report shape. Schema-only:
 * checks the spec's well-formedness, not runtime inputs.
 */
export const validateVestingScheduleTemplate = (
  t: VestingScheduleTemplate,
): ValidationResult => {
  const errors: ValidationError[] = [];

  if (typeof t.id !== "string" || t.id.length === 0) {
    errors.push({ path: "id", message: "must be a non-empty string" });
  }

  if (!Array.isArray(t.statements) || t.statements.length === 0) {
    errors.push({ path: "statements", message: "must be a non-empty array" });
  } else {
    t.statements.forEach((s, i) => {
      validateStatement(s, `statements[${i}]`, errors);
    });

    const totalOccurrences = t.statements.reduce(
      (sum, s) => sum + (isPositiveInt(s.occurrences) ? s.occurrences : 0),
      0,
    );
    if (totalOccurrences > MAX_INSTALLMENTS) {
      errors.push({
        path: "statements",
        message: installmentCapMessage(totalOccurrences),
      });
    }

    const ordersSeen = new Map<number, number[]>();
    t.statements.forEach((s, i) => {
      if (isPositiveInt(s.order)) {
        const indices = ordersSeen.get(s.order) ?? [];
        indices.push(i);
        ordersSeen.set(s.order, indices);
      }
    });
    for (const [order, indices] of ordersSeen) {
      if (indices.length > 1) {
        errors.push({
          path: "statements",
          message: `duplicate order ${order} at indices [${indices.join(", ")}]`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
};

const fractionInUnitInterval = (f: Fraction): boolean => {
  // Valid fractions reach this point (denominator >= 1).
  if (f.numerator < 0) return false;
  // numerator/denominator <= 1 ⇔ numerator <= denominator
  return f.numerator <= f.denominator;
};

// A stored Numeric percentage lies in [0, 1]. Parse to the exact rational and
// reuse the fraction bound check, so the decimal and the fraction paths can't
// disagree on where the interval edges sit. The caller has already confirmed the
// string is a well-formed Numeric.
const numericInUnitInterval = (n: string): boolean =>
  fractionInUnitInterval(numericToFraction(n));

/**
 * Validates the per-grant runtime data passed to the compiler against the
 * template. Catches mismatches that the static template validator cannot:
 *   - startDate required when the template has any statement (all DATE-anchored);
 *     a contingent start's CONTINGENT_START_SENTINEL is a real calendar date, so
 *     it passes the format check and the compiler's sentinel-skip handles it.
 *   - no duplicate event_id in eventFirings (single firing per event_id)
 *   - dates must be real calendar dates (2025-02-31 is rejected, not rolled)
 *   - realized_fraction (if present) must be a valid Fraction in [0, 1]
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
        if (firing?.realized_fraction !== undefined) {
          validateFraction(
            firing.realized_fraction,
            `${path}.realized_fraction`,
            errors,
          );
          // Only check interval bounds if the fraction itself parsed OK.
          if (
            isInteger(firing.realized_fraction.numerator) &&
            isPositiveInt(firing.realized_fraction.denominator) &&
            !fractionInUnitInterval(firing.realized_fraction)
          ) {
            errors.push({
              path: `${path}.realized_fraction`,
              message: "must be in the closed interval [0, 1]",
            });
          }
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
