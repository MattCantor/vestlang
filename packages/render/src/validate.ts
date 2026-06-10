// Structural guard the stringifier runs before it prints. The printer assumes a
// well-formed normalized AST; given a structurally-plausible node with bad
// values (a negative cadence step, a non-calendar DATE literal) it would happily
// emit DSL the parser then rejects — `OVER 15 days EVERY -5 days`, `DATE
// not-a-date`. So validate first and fail with a single readable message rather
// than emit text that can't round-trip.
//
// The rules here mirror what the grammar accepts (see packages/dsl/src/grammar):
//   - durations are a non-negative Integer plus a separate sign, so a duration's
//     `value` must be a non-negative integer;
//   - OVER/EVERY forbid negative spans/steps, so cadence `length`/`occurrences`
//     must be non-negative integers;
//   - a DATE literal must be a real calendar date;
//   - a QUANTITY amount is a non-negative integer; a PORTION is integer/integer
//     with a positive denominator.
//
// This is a DSL-AST guard, a different layer from @vestlang/core's validator,
// which checks the canonical interchange template — don't conflate the two.

import { isValidCalendarDate } from "@vestlang/utils";
import type {
  Amount,
  ChainedSchedule,
  Condition,
  Constraint,
  Duration,
  Offsets,
  Program,
  Schedule,
  ScheduleExpr,
  Statement,
  VestingBase,
  VestingNode,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";

interface AstError {
  path: string;
  message: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const isInteger = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n);

const isNonNegativeInt = (n: unknown): n is number => isInteger(n) && n >= 0;

function pushTypeError(
  node: unknown,
  expected: string,
  path: string,
  errors: AstError[],
): void {
  const seen = isObject(node)
    ? `type "${String((node as { type?: unknown }).type)}"`
    : node === null
      ? "null"
      : typeof node;
  errors.push({ path, message: `expected ${expected}, got ${seen}` });
}

function validateDuration(d: Duration, path: string, errors: AstError[]): void {
  if (!isNonNegativeInt(d.value)) {
    // A negative magnitude here renders as e.g. `-5 days`, which the grammar's
    // Integer rule rejects; direction belongs on `sign`, not the value.
    errors.push({
      path: `${path}.value`,
      message: "must be a non-negative integer (direction is carried by sign)",
    });
  }
  if (d.unit !== "DAYS" && d.unit !== "MONTHS") {
    errors.push({
      path: `${path}.unit`,
      message: 'must be "DAYS" or "MONTHS"',
    });
  }
  if (d.sign !== "PLUS" && d.sign !== "MINUS") {
    errors.push({ path: `${path}.sign`, message: 'must be "PLUS" or "MINUS"' });
  }
}

function validateOffsets(
  offsets: Offsets,
  path: string,
  errors: AstError[],
): void {
  if (!Array.isArray(offsets)) {
    errors.push({ path, message: "must be an array" });
    return;
  }
  offsets.forEach((o: Duration, i) =>
    validateDuration(o, `${path}[${i}]`, errors),
  );
}

function validateVestingBase(
  base: VestingBase,
  path: string,
  errors: AstError[],
): void {
  if (!isObject(base)) {
    pushTypeError(base, "a vesting base", path, errors);
    return;
  }
  switch (base.type) {
    case "DATE":
      if (typeof base.value !== "string" || !isValidCalendarDate(base.value)) {
        errors.push({
          path: `${path}.value`,
          message: `"${String(base.value)}" is not a valid calendar date (YYYY-MM-DD)`,
        });
      }
      break;
    case "EVENT":
      if (typeof base.value !== "string" || base.value.length === 0) {
        errors.push({
          path: `${path}.value`,
          message: "must be a non-empty event name",
        });
      }
      break;
    case "GRANT_DATE":
    case "VESTING_START":
      break;
    default:
      pushTypeError(base, "a DATE, EVENT, or system anchor", path, errors);
  }
}

function validateConstraint(
  c: Constraint,
  path: string,
  errors: AstError[],
): void {
  if (!isObject(c)) {
    pushTypeError(c, "a constraint", path, errors);
    return;
  }
  if (c.type !== "BEFORE" && c.type !== "AFTER") {
    errors.push({
      path: `${path}.type`,
      message: 'must be "BEFORE" or "AFTER"',
    });
  }
  validateVestingNode(c.base, `${path}.base`, errors);
}

function validateCondition(
  cond: Condition,
  path: string,
  errors: AstError[],
): void {
  if (!isObject(cond)) {
    pushTypeError(cond, "a condition", path, errors);
    return;
  }
  switch (cond.type) {
    case "ATOM":
      validateConstraint(cond.constraint, `${path}.constraint`, errors);
      break;
    case "AND":
    case "OR":
      if (!Array.isArray(cond.items) || cond.items.length < 2) {
        errors.push({
          path: `${path}.items`,
          message: "must hold two or more conditions",
        });
      } else {
        cond.items.forEach((item, i) =>
          validateCondition(item, `${path}.items[${i}]`, errors),
        );
      }
      break;
    default:
      pushTypeError(cond, "an ATOM, AND, or OR condition", path, errors);
  }
}

function validateVestingNode(
  node: VestingNode,
  path: string,
  errors: AstError[],
): void {
  if (!isObject(node) || node.type !== "NODE") {
    pushTypeError(node, "a NODE", path, errors);
    return;
  }
  validateVestingBase(node.base, `${path}.base`, errors);
  validateOffsets(node.offsets, `${path}.offsets`, errors);
  if (node.condition) {
    validateCondition(node.condition, `${path}.condition`, errors);
  }
}

function validateVestingNodeExpr(
  node: VestingNodeExpr,
  path: string,
  errors: AstError[],
): void {
  if (!isObject(node)) {
    pushTypeError(node, "a vesting-node expression", path, errors);
    return;
  }
  switch (node.type) {
    case "NODE":
      validateVestingNode(node, path, errors);
      break;
    case "NODE_LATER_OF":
    case "NODE_EARLIER_OF":
      if (!Array.isArray(node.items) || node.items.length < 2) {
        errors.push({
          path: `${path}.items`,
          message: "must hold two or more candidates",
        });
      } else {
        node.items.forEach((item, i) =>
          validateVestingNodeExpr(item, `${path}.items[${i}]`, errors),
        );
      }
      break;
    default:
      // A raw parse AST leaves cliffs as bare DURATIONs and the like; those have
      // no rendering. Name the offending type so the failure points at the cause.
      pushTypeError(
        node,
        "a normalized node expression (NODE / selector); a raw, un-normalized DURATION cliff is not renderable",
        path,
        errors,
      );
  }
}

function validatePeriodicity(
  p: VestingPeriod,
  path: string,
  errors: AstError[],
): void {
  if (!isObject(p)) {
    pushTypeError(p, "a periodicity", path, errors);
    return;
  }
  if (!isNonNegativeInt(p.length)) {
    errors.push({
      path: `${path}.length`,
      message: "must be a non-negative integer",
    });
  }
  if (!isNonNegativeInt(p.occurrences)) {
    errors.push({
      path: `${path}.occurrences`,
      message: "must be a non-negative integer",
    });
  }
  if (p.type !== "DAYS" && p.type !== "MONTHS") {
    errors.push({
      path: `${path}.type`,
      message: 'must be "DAYS" or "MONTHS"',
    });
  }
  if (p.cliff) {
    validateVestingNodeExpr(p.cliff, `${path}.cliff`, errors);
  }
}

function validateSchedule(
  s: Schedule | ChainedSchedule,
  path: string,
  errors: AstError[],
): void {
  // A chained tail's start is null; an ordinary schedule's is a node expression.
  if (s.vesting_start !== null) {
    validateVestingNodeExpr(s.vesting_start, `${path}.vesting_start`, errors);
  }
  validatePeriodicity(s.periodicity, `${path}.periodicity`, errors);
}

function validateScheduleExpr(
  e: ScheduleExpr | ChainedSchedule,
  path: string,
  errors: AstError[],
): void {
  if (!isObject(e)) {
    pushTypeError(e, "a schedule expression", path, errors);
    return;
  }
  switch (e.type) {
    case "SCHEDULE":
      validateSchedule(e, path, errors);
      break;
    case "SCHEDULE_LATER_OF":
    case "SCHEDULE_EARLIER_OF":
      if (!Array.isArray(e.items) || e.items.length < 2) {
        errors.push({
          path: `${path}.items`,
          message: "must hold two or more candidates",
        });
      } else {
        e.items.forEach((item, i) =>
          validateScheduleExpr(item, `${path}.items[${i}]`, errors),
        );
      }
      break;
    default:
      pushTypeError(e, "a SCHEDULE or schedule selector", path, errors);
  }
}

function validateAmount(a: Amount, path: string, errors: AstError[]): void {
  if (!isObject(a)) {
    pushTypeError(a, "an amount", path, errors);
    return;
  }
  switch (a.type) {
    case "QUANTITY":
      if (!isNonNegativeInt(a.value)) {
        errors.push({
          path: `${path}.value`,
          message: "must be a non-negative integer",
        });
      }
      break;
    case "PORTION":
      if (!isInteger(a.numerator) || a.numerator < 0) {
        errors.push({
          path: `${path}.numerator`,
          message: "must be a non-negative integer",
        });
      }
      if (!isInteger(a.denominator) || a.denominator <= 0) {
        errors.push({
          path: `${path}.denominator`,
          message: "must be a positive integer",
        });
      }
      break;
    default:
      pushTypeError(a, "a QUANTITY or PORTION amount", path, errors);
  }
}

function validateStatement(
  s: Statement,
  path: string,
  errors: AstError[],
): void {
  if (!isObject(s) || s.type !== "STATEMENT") {
    pushTypeError(s, "a STATEMENT", path, errors);
    return;
  }
  validateAmount(s.amount, `${path}.amount`, errors);
  validateScheduleExpr(s.expr, `${path}.expr`, errors);
}

const formatErrors = (errors: AstError[]): string =>
  errors.map((e) => `  - ${e.path || "(root)"}: ${e.message}`).join("\n");

/**
 * Throw a single, readable Error when `node` is not a printable normalized AST.
 * Called at the top of every public stringify entry point so the printer only
 * ever sees a node whose values the grammar would accept back.
 */
export function assertPrintable(node: Statement | Program): void {
  const errors: AstError[] = [];
  if (Array.isArray(node)) {
    node.forEach((s, i) => validateStatement(s, `[${i}]`, errors));
  } else {
    validateStatement(node, "", errors);
  }
  if (errors.length > 0) {
    throw new Error(
      `Cannot stringify AST: it is not a well-formed normalized vestlang program.\n${formatErrors(
        errors,
      )}`,
    );
  }
}
