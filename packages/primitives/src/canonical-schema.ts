// The one shared Zod schema for the canonical vesting *template* — the
// interchange shape both the reference compiler (`@vestlang/core`) and the MCP
// server's persisted-artifact validator parse untrusted wire input against. Before
// this module the two kept the same rules in lockstep by hand and drifted; now the
// definition lives once and the lockstep is compile-time.
//
// Authored in Zod 4 Mini (`zod/mini`) on purpose: `core` inlines its validation
// code into the published bundle, and Mini's tree-shakeable surface keeps that
// bundle small. The mcp server's outer `PERSISTED_ARTIFACT` wrapper stays full
// `zod` (it wants `.describe()` and the `satisfies` pin); a full-`zod` object
// accepts a Mini child at runtime.
//
// The scalar fields and the collection invariants emit the exact messages the
// hand-rolled validator used, so the message assertions downstream keep passing.
// The statement is a two-arm union (scheduled / pure-milestone), which is the only
// shape that makes the neither-corner — a slice with neither a time grid nor an
// event to vest on — unrepresentable rather than merely caught by a refinement.
// A union loses the deep error path, though, so `zodIssuesToValidationErrors`
// reconstructs it (see below).

import * as z from "zod/mini";

import { NUMERIC_PATTERN_SOURCE } from "@vestlang/types";
import { isValidCalendarDate, tryNumericToFraction } from "@vestlang/utils";

import { installmentCapMessage, MAX_INSTALLMENTS } from "./limits.js";

/* ------------------------------------------------------------------ *
 * The ValidationError shape core hands back. Declared here (not imported
 * from core) because core consumes this module, not the other way round —
 * and it keeps zod out of core's public types entirely.
 * ------------------------------------------------------------------ */

export interface ValidationError {
  path: string;
  message: string;
}

/* ------------------------------------------------------------------ *
 * Scalars
 * ------------------------------------------------------------------ */

// An integer field with a lower bound, emitting one exact message for every way
// it can be wrong (not a number, not an integer, below the bound). The base
// `z.number` carries that message too, so a wrong-typed value (a string where a
// number belongs) reads the same as an out-of-range one — the way the
// hand-rolled validator always phrased it. The custom check then handles the
// integer/range part, on a value the base has already confirmed is a number.
const boundedInt = (min: number, message: string) =>
  z.number({ error: message }).check(
    z.check((ctx) => {
      const v = ctx.value;
      if (!Number.isInteger(v) || v < min) {
        ctx.issues.push({ code: "custom", message, input: v });
      }
    }),
  );

// The OCF `Numeric` decimal grammar, shared with the rest of the repo. A bare
// regex match — the bound checks live in the percentage fields below.
export const NUMERIC = z
  .string()
  .check(z.regex(new RegExp(NUMERIC_PATTERN_SOURCE)));

export const PERIOD_TYPE = z.enum(["DAYS", "MONTHS", "YEARS"], {
  error: "must be one of DAYS, MONTHS, YEARS",
});

// A real calendar date in `YYYY-MM-DD` form — regex shape plus the leap-aware
// validity check, so `2025-02-31` is rejected rather than silently rolled.
export const CALENDAR_DATE = z
  .string()
  .check(
    z.refine(
      (s) => isValidCalendarDate(s),
      "must be a real calendar date (YYYY-MM-DD)",
    ),
  );

// A statement's share of the whole grant. A regex match can confirm the *shape*
// but not the value: an oversized-but-well-formed Numeric (one that can't round-
// trip through a JS number) must be refused, and a negative share makes the
// allocator emit negative installments. So parse non-throwingly and branch on the
// result. The upper bound is deliberately *not* checked — a clause over 1 is the
// evaluator's over-allocation finding, not a hard validator error.
export const SHARE_OF_GRANT = z
  .string({ error: "must be an OCF Numeric string" })
  .check(
    z.check((ctx) => {
      const v = ctx.value;
      if (!new RegExp(NUMERIC_PATTERN_SOURCE).test(v)) {
        ctx.issues.push({
          code: "custom",
          message: "must be an OCF Numeric string",
          input: v,
        });
        return;
      }
      const f = tryNumericToFraction(v);
      if (f === null) {
        ctx.issues.push({
          code: "custom",
          message: "is too large to represent exactly",
          input: v,
        });
      } else if (f.numerator < 0) {
        ctx.issues.push({ code: "custom", message: "must be >= 0", input: v });
      }
    }),
  );

// A cliff's share of its statement, which once parsed must lie in the closed unit
// interval. Same malformed/oversized handling as the grant share, then a [0, 1]
// bound check on the parsed value.
export const SHARE_OF_STATEMENT = z
  .string({ error: "must be an OCF Numeric string" })
  .check(
    z.check((ctx) => {
      const v = ctx.value;
      if (!new RegExp(NUMERIC_PATTERN_SOURCE).test(v)) {
        ctx.issues.push({
          code: "custom",
          message: "must be an OCF Numeric string",
          input: v,
        });
        return;
      }
      const f = tryNumericToFraction(v);
      if (f === null) {
        ctx.issues.push({
          code: "custom",
          message: "is too large to represent exactly",
          input: v,
        });
      } else if (f.numerator < 0 || f.numerator > f.denominator) {
        // numerator/denominator in [0, 1] ⇔ 0 <= numerator <= denominator
        // (denominator is always >= 1 for a parsed fraction).
        ctx.issues.push({
          code: "custom",
          message: "must be in the closed interval [0, 1]",
          input: v,
        });
      }
    }),
  );

/* ------------------------------------------------------------------ *
 * Template structure
 * ------------------------------------------------------------------ */

export const CLIFF = z.strictObject({
  length: boundedInt(0, "must be an integer >= 0"),
  period_type: PERIOD_TYPE,
  percentage: SHARE_OF_STATEMENT,
});

// The event hold on a statement's grid: the gating event's id (a real user event
// or a reserved synthetic `evt:<n>` whose recipe lives out-of-band in the
// sidecar). The string error and the min-length error share one message so a
// non-string and an empty string read identically.
export const EVENT_CONDITION = z.strictObject({
  event_id: z
    .string("must be a non-empty string")
    .check(z.minLength(1, "must be a non-empty string")),
});

// The time grid (with its optional cliff). Present on a scheduled statement;
// absent on a pure milestone.
export const SCHEDULE = z.strictObject({
  occurrences: boundedInt(1, "must be an integer >= 1"),
  period: boundedInt(0, "must be an integer >= 0"),
  period_type: PERIOD_TYPE,
  cliff: z.optional(CLIFF),
});

// A statement is exactly one of two shapes. Strict objects on both arms are what
// forbid the neither-corner and a stray `schedule` on a milestone — a flat object
// with a refinement could not.
export const VESTING_STATEMENT = z.union([
  // Scheduled (DATE / HYBRID): a `schedule`, optionally also an `event_condition`.
  z.strictObject({
    order: boundedInt(1, "must be an integer >= 1"),
    schedule: SCHEDULE,
    event_condition: z.optional(EVENT_CONDITION),
    percentage: SHARE_OF_GRANT,
  }),
  // Pure milestone: an `event_condition`, no `schedule` key.
  z.strictObject({
    order: boundedInt(1, "must be an integer >= 1"),
    event_condition: EVENT_CONDITION,
    percentage: SHARE_OF_GRANT,
  }),
]);

// A scheduled statement contributes its grid's occurrence count toward the cap; a
// schedule-less milestone counts as a single installment.
const occurrencesOf = (s: unknown): number => {
  if (typeof s !== "object" || s === null) return 0;
  const stmt = s as { schedule?: { occurrences?: unknown } };
  if (stmt.schedule === undefined) return 1;
  const occ = stmt.schedule.occurrences;
  return typeof occ === "number" && Number.isInteger(occ) && occ > 0 ? occ : 0;
};

export const TEMPLATE = z
  .strictObject({
    // The base message covers a non-string `id`; the collection check below
    // covers the empty-string case. (A non-array `statements` falls through to
    // the array element validation; the empty-array case is the check's.)
    id: z.string({ error: "must be a non-empty string" }),
    statements: z.array(VESTING_STATEMENT),
  })
  // The collection invariants below run only when every field — including each
  // statement — parses: Zod skips an object's refinement once a field has failed.
  // That's fine here. A malformed statement already makes the template invalid, so
  // the verdict never depends on these also firing; they add the duplicate-order
  // and cap diagnostics on an otherwise well-formed set of statements.
  .check(
    z.check((ctx) => {
      const t = ctx.value as {
        id: string;
        statements: Array<{ order?: unknown }>;
      };

      if (typeof t.id !== "string" || t.id.length === 0) {
        ctx.issues.push({
          code: "custom",
          message: "must be a non-empty string",
          input: t,
          path: ["id"],
        });
      }

      if (!Array.isArray(t.statements) || t.statements.length === 0) {
        ctx.issues.push({
          code: "custom",
          message: "must be a non-empty array",
          input: t,
          path: ["statements"],
        });
        return;
      }

      const total = t.statements.reduce((sum, s) => sum + occurrencesOf(s), 0);
      if (total > MAX_INSTALLMENTS) {
        ctx.issues.push({
          code: "custom",
          message: installmentCapMessage(total),
          input: t,
          path: ["statements"],
        });
      }

      const ordersSeen = new Map<number, number[]>();
      t.statements.forEach((s, i) => {
        const order = s.order;
        if (typeof order === "number" && Number.isInteger(order) && order > 0) {
          const indices = ordersSeen.get(order) ?? [];
          indices.push(i);
          ordersSeen.set(order, indices);
        }
      });
      for (const [order, indices] of ordersSeen) {
        if (indices.length > 1) {
          ctx.issues.push({
            code: "custom",
            message: `duplicate order ${order} at indices [${indices.join(", ")}]`,
            input: t,
            path: ["statements"],
          });
        }
      }
    }),
  );

/* ------------------------------------------------------------------ *
 * Adapter: Zod issues → core's ValidationError[]
 * ------------------------------------------------------------------ */

// A Zod path segment is a string key or a numeric array index. Render the whole
// path in the `a.b[i].c` form the hand-rolled validator emitted.
const formatPath = (path: ReadonlyArray<PropertyKey>): string => {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") {
      out += `[${seg}]`;
    } else {
      out += out === "" ? String(seg) : `.${String(seg)}`;
    }
  }
  return out;
};

// A statement value has a `schedule` key (the scheduled arm) or not (the
// milestone arm). Plain key presence, not a full parse — that's exactly the bit
// Zod used to pick the arm before it failed.
const hasOwn = (value: unknown, key: string): boolean =>
  typeof value === "object" && value !== null && key in value;

// A minimal view of the bits of a Zod issue this adapter reads. Mini's issue
// objects carry more, but pinning to this keeps zod's types out of the signature.
interface ZodLikeIssue {
  code: string;
  message: string;
  path: ReadonlyArray<PropertyKey>;
  // Present only on an `invalid_union` issue: one sub-issue list per arm.
  errors?: ReadonlyArray<ReadonlyArray<ZodLikeIssue>>;
}

/**
 * Map a Zod `safeParse` failure's issues into core's `ValidationError[]`,
 * preserving the exact paths and messages the hand-rolled validator produced.
 *
 * The hard case is the two-arm statement union. When a deep field in the
 * *scheduled* arm is bad, Zod can't pick an arm — the milestone arm fails on the
 * stray `schedule` key — so it collapses to a single `invalid_union` issue at
 * `["statements", i]` and the deep path (`…cliff.length`, `…period_type`, …) is
 * gone from the top-level issue. The fix is deterministic, not a heuristic:
 *
 *   - If the offending statement has neither a `schedule` nor an
 *     `event_condition` key, that's the illegal neither-corner — emit the one
 *     message for it at the statement path and stop.
 *   - Otherwise pick the arm by `schedule` presence (the same bit Zod would
 *     have), descend into that arm's recorded sub-issues, and re-prefix each with
 *     the statement path. This restores `statements[i].schedule.cliff.length`,
 *     `.schedule.period_type`, `.schedule.cliff.percentage`, `.percentage`, and
 *     `.event_condition.event_id`.
 *
 * Non-union issues (the top-level `id`/`statements`, the collection checks, and
 * any milestone-arm field Zod matched cleanly) already carry their full path, so
 * they map by formatting it.
 */
export const zodIssuesToValidationErrors = (
  issues: ReadonlyArray<ZodLikeIssue>,
  input: unknown,
): ValidationError[] => {
  const errors: ValidationError[] = [];

  for (const issue of issues) {
    const isStatementUnion =
      issue.code === "invalid_union" &&
      issue.path.length === 2 &&
      issue.path[0] === "statements" &&
      typeof issue.path[1] === "number";

    if (!isStatementUnion) {
      errors.push({ path: formatPath(issue.path), message: issue.message });
      continue;
    }

    const index = issue.path[1] as number;
    const statementPath = `statements[${index}]`;
    const statements =
      typeof input === "object" && input !== null
        ? (input as { statements?: unknown }).statements
        : undefined;
    const statement: unknown = Array.isArray(statements)
      ? (statements as unknown[])[index]
      : undefined;

    // A non-object element (a primitive or null) can't carry either key. Name
    // that directly rather than blaming a missing schedule/event below.
    if (typeof statement !== "object" || statement === null) {
      errors.push({ path: statementPath, message: "must be an object" });
      continue;
    }

    // Neither-corner: no grid and nothing to vest on. One message, no walk.
    if (
      !hasOwn(statement, "schedule") &&
      !hasOwn(statement, "event_condition")
    ) {
      errors.push({
        path: statementPath,
        message: "must carry a schedule, an event_condition, or both",
      });
      continue;
    }

    // Arm 0 is the scheduled arm; arm 1 the milestone. Pick by `schedule`
    // presence — the bit that decides which arm the value was meant for.
    const armIndex = hasOwn(statement, "schedule") ? 0 : 1;
    const armIssues = issue.errors?.[armIndex];
    if (armIssues) {
      for (const sub of armIssues) {
        // A sub-issue can sit on the statement itself (e.g. an unrecognized key
        // reports an empty path) — keep the bare statement path then, no dot.
        const subPath = formatPath(sub.path);
        errors.push({
          path: subPath ? `${statementPath}.${subPath}` : statementPath,
          message: sub.message,
        });
      }
    } else {
      // Defensive: a union issue with no recorded sub-issues. Keep the corner
      // visible rather than dropping it silently.
      errors.push({ path: statementPath, message: issue.message });
    }
  }

  return errors;
};
