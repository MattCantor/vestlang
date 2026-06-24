import { describe, it, expect } from "vitest";
import type { Program, Statement, VestingNodeExpr } from "@vestlang/types";
import {
  collectAstErrors,
  collectNodeExprErrors,
  formatAstErrors,
  type AstError,
} from "../src/index.js";

// Branch coverage for validate.ts. The stringify suite exercises the collector
// only through `stringify` (a handful of malformed shapes); here we hit the
// per-field value rules directly, one corrupted field at a time, asserting the
// exact path and message so a boundary flip (`>= 0` → `> 0`) or a reworded
// complaint can't slip through. Every block also pins the *valid* boundary, so a
// mutant that simply stops reporting is caught by the negative case.

/* ------------------------
 * Helpers
 * ------------------------ */

const at = (errors: AstError[], path: string): AstError | undefined =>
  errors.find((e) => e.path === path);

const msgAt = (errors: AstError[], path: string): string | undefined =>
  at(errors, path)?.message;

/** A fully valid one-statement schedule. Each test clones this and corrupts a
 *  single field, so the only error that surfaces is the one under test. */
const validStatement = (): Statement => ({
  type: "STATEMENT",
  amount: { type: "PORTION", numerator: 1, denominator: 1 },
  expr: {
    type: "SCHEDULE",
    vesting_start: { type: "NODE", base: { type: "GRANT_DATE" }, offsets: [] },
    periodicity: { type: "MONTHS", length: 1, occurrences: 48 },
  },
});

// Build a corrupted statement by deep-cloning the valid one and mutating it.
const corrupt = (mutate: (s: Record<string, unknown>) => void): Statement => {
  const s = structuredClone(validStatement()) as unknown as Record<
    string,
    unknown
  >;
  mutate(s);
  return s as unknown as Statement;
};

const errs = (s: Statement | Program): AstError[] => collectAstErrors(s);

/* ------------------------
 * The valid baseline
 * ------------------------ */

describe("a well-formed statement is clean", () => {
  it("reports nothing for the valid baseline", () => {
    expect(errs(validStatement())).toEqual([]);
  });

  it("reports nothing for a one-statement program (array entry path is [0])", () => {
    expect(errs([validStatement()])).toEqual([]);
  });
});

/* ------------------------
 * validateAmount
 * ------------------------ */

describe("amount", () => {
  it("QUANTITY: 0 is allowed, -1 is not", () => {
    const ok = corrupt((s) => {
      (s.amount as Record<string, unknown>) = { type: "QUANTITY", value: 0 };
    });
    expect(errs(ok)).toEqual([]);

    const bad = corrupt((s) => {
      (s.amount as Record<string, unknown>) = { type: "QUANTITY", value: -1 };
    });
    expect(msgAt(errs(bad), ".amount.value")).toBe(
      "must be a non-negative integer",
    );
  });

  it("QUANTITY: a fractional value is rejected (integer check)", () => {
    const bad = corrupt((s) => {
      (s.amount as Record<string, unknown>) = { type: "QUANTITY", value: 1.5 };
    });
    expect(msgAt(errs(bad), ".amount.value")).toBe(
      "must be a non-negative integer",
    );
  });

  it("PORTION: numerator may be 0 but not negative", () => {
    const ok = corrupt((s) => {
      (s.amount as Record<string, number | string>).numerator = 0;
    });
    expect(errs(ok)).toEqual([]);

    const bad = corrupt((s) => {
      (s.amount as Record<string, number | string>).numerator = -1;
    });
    expect(msgAt(errs(bad), ".amount.numerator")).toBe(
      "must be a non-negative integer",
    );
  });

  it("PORTION: denominator must be strictly positive (0 and -1 rejected, 1 ok)", () => {
    const zero = corrupt((s) => {
      (s.amount as Record<string, number | string>).denominator = 0;
    });
    expect(msgAt(errs(zero), ".amount.denominator")).toBe(
      "must be a positive integer",
    );

    const neg = corrupt((s) => {
      (s.amount as Record<string, number | string>).denominator = -1;
    });
    expect(msgAt(errs(neg), ".amount.denominator")).toBe(
      "must be a positive integer",
    );

    const one = corrupt((s) => {
      (s.amount as Record<string, number | string>).denominator = 1;
    });
    expect(errs(one)).toEqual([]);
  });

  it("an unknown amount type names the offending type", () => {
    const bad = corrupt((s) => {
      (s.amount as Record<string, unknown>) = { type: "NOPE" };
    });
    expect(msgAt(errs(bad), ".amount")).toBe(
      'expected a QUANTITY or PORTION amount, got type "NOPE"',
    );
  });

  it("a null amount reports `null`, not a crash", () => {
    const bad = corrupt((s) => {
      s.amount = null;
    });
    expect(msgAt(errs(bad), ".amount")).toBe("expected an amount, got null");
  });

  it("a primitive amount reports its typeof", () => {
    const bad = corrupt((s) => {
      s.amount = "1/2";
    });
    expect(msgAt(errs(bad), ".amount")).toBe("expected an amount, got string");
  });
});

/* ------------------------
 * validatePeriodicity
 * ------------------------ */

describe("periodicity", () => {
  it("length must be a non-negative integer", () => {
    const bad = corrupt((s) => {
      const e = s.expr as Record<string, Record<string, unknown>>;
      e.periodicity.length = -5;
    });
    expect(msgAt(errs(bad), ".expr.periodicity.length")).toBe(
      "must be a non-negative integer",
    );
  });

  it("occurrences must be a non-negative integer", () => {
    const bad = corrupt((s) => {
      const e = s.expr as Record<string, Record<string, unknown>>;
      e.periodicity.occurrences = -1;
    });
    expect(msgAt(errs(bad), ".expr.periodicity.occurrences")).toBe(
      "must be a non-negative integer",
    );
  });

  it("type must be DAYS or MONTHS", () => {
    const bad = corrupt((s) => {
      const e = s.expr as Record<string, Record<string, unknown>>;
      e.periodicity.type = "YEARS";
    });
    expect(msgAt(errs(bad), ".expr.periodicity.type")).toBe(
      'must be "DAYS" or "MONTHS"',
    );
  });

  it("a non-object periodicity is flagged", () => {
    const bad = corrupt((s) => {
      (s.expr as Record<string, unknown>).periodicity = null;
    });
    expect(msgAt(errs(bad), ".expr.periodicity")).toBe(
      "expected a periodicity, got null",
    );
  });

  it("a bad cliff inside periodicity is reached", () => {
    const bad = corrupt((s) => {
      const e = s.expr as Record<string, Record<string, unknown>>;
      e.periodicity.cliff = { type: "DURATION", value: 12 };
    });
    // The raw DURATION cliff is not a renderable node expression.
    expect(msgAt(errs(bad), ".expr.periodicity.cliff")).toMatch(
      /un-normalized DURATION cliff is not renderable/,
    );
  });
});

/* ------------------------
 * validateScheduleExpr
 * ------------------------ */

describe("schedule expression", () => {
  it("a chained-tail null start is allowed (no vesting_start error)", () => {
    const tail = corrupt((s) => {
      s.chained = true;
      (s.expr as Record<string, unknown>).vesting_start = null;
    });
    expect(errs(tail)).toEqual([]);
  });

  it("a one-arm schedule selector trips the arity rule", () => {
    const arm = {
      type: "SCHEDULE",
      vesting_start: {
        type: "NODE",
        base: { type: "GRANT_DATE" },
        offsets: [],
      },
      periodicity: { type: "MONTHS", length: 1, occurrences: 12 },
    };
    const bad = corrupt((s) => {
      (s.expr as Record<string, unknown>) = {
        type: "SCHEDULE_LATER_OF",
        items: [arm],
      };
    });
    expect(msgAt(errs(bad), ".expr.items")).toBe(
      "must hold two or more candidates",
    );
  });

  it("a schedule selector recurses into each candidate by index", () => {
    const arm = (length: number) => ({
      type: "SCHEDULE",
      vesting_start: {
        type: "NODE",
        base: { type: "GRANT_DATE" },
        offsets: [],
      },
      periodicity: { type: "MONTHS", length, occurrences: 12 },
    });
    const bad = corrupt((s) => {
      (s.expr as Record<string, unknown>) = {
        type: "SCHEDULE_EARLIER_OF",
        items: [arm(1), arm(-1)],
      };
    });
    // Two valid-shaped arms clear the arity rule; the corrupt second arm's bad
    // length is reported under its own index.
    expect(msgAt(errs(bad), ".expr.items[1].periodicity.length")).toBe(
      "must be a non-negative integer",
    );
  });

  it("an unknown schedule-expr type is named", () => {
    const bad = corrupt((s) => {
      (s.expr as Record<string, unknown>) = { type: "WAT" };
    });
    expect(msgAt(errs(bad), ".expr")).toBe(
      'expected a SCHEDULE or schedule selector, got type "WAT"',
    );
  });

  it("a non-object schedule expr is flagged", () => {
    const bad = corrupt((s) => {
      s.expr = 42;
    });
    expect(msgAt(errs(bad), ".expr")).toBe(
      "expected a schedule expression, got number",
    );
  });
});

/* ------------------------
 * validateStatement / collectAstErrors entry
 * ------------------------ */

describe("statement entry", () => {
  it("a non-STATEMENT top-level node is flagged at the root path", () => {
    expect(
      msgAt(collectAstErrors({ type: "NOPE" } as unknown as Statement), ""),
    ).toBe('expected a STATEMENT, got type "NOPE"');
  });

  it("program errors carry their statement index in the path", () => {
    const bad = corrupt((s) => {
      const e = s.expr as Record<string, Record<string, unknown>>;
      e.periodicity.length = -1;
    });
    const program: Program = [validStatement(), bad];
    expect(msgAt(errs(program), "[1].expr.periodicity.length")).toBe(
      "must be a non-negative integer",
    );
  });

  it("a bad start is reported under the .expr.vesting_start path", () => {
    // Pins the path segment the schedule attaches to its start node, so a
    // start-originated error can't be mislabelled as if it came from the root.
    const bad = corrupt((s) => {
      const start = (
        s.expr as { vesting_start: { base: Record<string, unknown> } }
      ).vesting_start;
      start.base.type = "DATE";
      start.base.value = "2025-02-31";
    });
    expect(msgAt(errs(bad), ".expr.vesting_start.base.value")).toBe(
      '"2025-02-31" is not a valid calendar date (YYYY-MM-DD)',
    );
  });
});

/* ------------------------
 * validateVestingNodeExpr (node-level entry)
 * ------------------------ */

const node = (n: unknown): AstError[] =>
  collectNodeExprErrors(n as VestingNodeExpr);

describe("node-level entry (collectNodeExprErrors)", () => {
  it("a valid NODE is clean", () => {
    expect(
      node({ type: "NODE", base: { type: "GRANT_DATE" }, offsets: [] }),
    ).toEqual([]);
  });

  it("a non-object node is flagged at the root", () => {
    expect(msgAt(node(null), "")).toBe(
      "expected a vesting-node expression, got null",
    );
    expect(msgAt(node("x"), "")).toBe(
      "expected a vesting-node expression, got string",
    );
  });

  it("a raw DURATION (un-normalized cliff) is named, not silently dropped", () => {
    expect(msgAt(node({ type: "DURATION", value: 6 }), "")).toBe(
      'expected a normalized node expression (NODE / selector); a raw, un-normalized DURATION cliff is not renderable, got type "DURATION"',
    );
  });

  it("a NODE_LATER_OF with one arm trips the arity rule", () => {
    const bad = {
      type: "NODE_LATER_OF",
      items: [
        { type: "NODE", base: { type: "EVENT", value: "a" }, offsets: [] },
      ],
    };
    expect(msgAt(node(bad), ".items")).toBe("must hold two or more candidates");
  });

  it("a valid two-arm selector is clean", () => {
    const ok = {
      type: "NODE_EARLIER_OF",
      items: [
        { type: "NODE", base: { type: "EVENT", value: "a" }, offsets: [] },
        { type: "NODE", base: { type: "EVENT", value: "b" }, offsets: [] },
      ],
    };
    expect(node(ok)).toEqual([]);
  });
});

/* ------------------------
 * validateVestingBase
 * ------------------------ */

describe("vesting base", () => {
  const withBase = (base: unknown) => ({
    type: "NODE",
    base,
    offsets: [],
  });

  it("DATE: a real calendar date is accepted", () => {
    expect(node(withBase({ type: "DATE", value: "2024-02-29" }))).toEqual([]);
  });

  it("DATE: an impossible calendar date is rejected and quoted", () => {
    expect(
      msgAt(
        node(withBase({ type: "DATE", value: "2025-02-31" })),
        ".base.value",
      ),
    ).toBe('"2025-02-31" is not a valid calendar date (YYYY-MM-DD)');
  });

  it("DATE: a non-string value is rejected (stringified in the message)", () => {
    expect(
      msgAt(node(withBase({ type: "DATE", value: 20250101 })), ".base.value"),
    ).toBe('"20250101" is not a valid calendar date (YYYY-MM-DD)');
  });

  it("DATE: a non-string that merely *stringifies* to a valid date is still rejected", () => {
    // The `typeof === "string"` guard is load-bearing. isValidCalendarDate coerces
    // its argument via String(), so an array like ["2025-01-15"] would pass it —
    // the explicit type check is what keeps a non-string from slipping through.
    expect(
      msgAt(
        node(withBase({ type: "DATE", value: ["2025-01-15"] })),
        ".base.value",
      ),
    ).toBe('"2025-01-15" is not a valid calendar date (YYYY-MM-DD)');
  });

  it("EVENT: an empty name is rejected", () => {
    expect(
      msgAt(node(withBase({ type: "EVENT", value: "" })), ".base.value"),
    ).toBe("must be a non-empty event name");
  });

  it("EVENT: a non-string value is rejected (not just an empty string)", () => {
    expect(
      msgAt(node(withBase({ type: "EVENT", value: 123 })), ".base.value"),
    ).toBe("must be a non-empty event name");
  });

  it("EVENT: a non-empty name is accepted", () => {
    expect(node(withBase({ type: "EVENT", value: "grant" }))).toEqual([]);
  });

  it("system anchors GRANT_DATE / VESTING_START are accepted", () => {
    expect(node(withBase({ type: "GRANT_DATE" }))).toEqual([]);
    expect(node(withBase({ type: "VESTING_START" }))).toEqual([]);
  });

  it("a non-object base is flagged", () => {
    expect(msgAt(node(withBase(null)), ".base")).toBe(
      "expected a vesting base, got null",
    );
  });

  it("an unknown base type is named", () => {
    expect(msgAt(node(withBase({ type: "MOON_PHASE" })), ".base")).toBe(
      'expected a DATE, EVENT, or system anchor, got type "MOON_PHASE"',
    );
  });
});

/* ------------------------
 * validateOffsets / validateDuration
 * ------------------------ */

describe("offsets and durations", () => {
  const withOffsets = (offsets: unknown) => ({
    type: "NODE",
    base: { type: "EVENT", value: "a" },
    offsets,
  });

  it("offsets must be an array", () => {
    expect(msgAt(node(withOffsets("nope")), ".offsets")).toBe(
      "must be an array",
    );
  });

  it("a valid +N offset is accepted", () => {
    expect(
      node(withOffsets([{ value: 3, unit: "MONTHS", sign: "PLUS" }])),
    ).toEqual([]);
  });

  it("a negative offset magnitude is rejected (direction belongs on sign)", () => {
    const bad = withOffsets([{ value: -3, unit: "MONTHS", sign: "PLUS" }]);
    expect(msgAt(node(bad), ".offsets[0].value")).toBe(
      "must be a non-negative integer (direction is carried by sign)",
    );
  });

  it("a bad offset unit is rejected", () => {
    const bad = withOffsets([{ value: 3, unit: "YEARS", sign: "PLUS" }]);
    expect(msgAt(node(bad), ".offsets[0].unit")).toBe(
      'must be "DAYS" or "MONTHS"',
    );
  });

  it("a bad offset sign is rejected", () => {
    const bad = withOffsets([{ value: 3, unit: "DAYS", sign: "UP" }]);
    expect(msgAt(node(bad), ".offsets[0].sign")).toBe(
      'must be "PLUS" or "MINUS"',
    );
  });

  it("the second offset's index appears in the path", () => {
    const bad = withOffsets([
      { value: 3, unit: "MONTHS", sign: "PLUS" },
      { value: 2, unit: "WEEKS", sign: "PLUS" },
    ]);
    expect(msgAt(node(bad), ".offsets[1].unit")).toBe(
      'must be "DAYS" or "MONTHS"',
    );
  });
});

/* ------------------------
 * validateCondition / validateConstraint
 * ------------------------ */

describe("conditions and constraints", () => {
  const gated = (condition: unknown) => ({
    type: "NODE",
    base: { type: "EVENT", value: "a" },
    offsets: [],
    condition,
  });

  const atom = (constraint: unknown) => ({ type: "ATOM", constraint });

  const okConstraint = {
    type: "BEFORE",
    base: {
      type: "NODE",
      base: { type: "EVENT", value: "deadline" },
      offsets: [],
    },
    strict: false,
  };

  it("a valid ATOM gate is clean", () => {
    expect(node(gated(atom(okConstraint)))).toEqual([]);
  });

  it("a constraint type other than BEFORE/AFTER is rejected", () => {
    const bad = gated(atom({ ...okConstraint, type: "DURING" }));
    expect(msgAt(node(bad), ".condition.constraint.type")).toBe(
      'must be "BEFORE" or "AFTER"',
    );
  });

  it("a constraint recurses into its reference node", () => {
    const bad = gated(
      atom({
        type: "AFTER",
        base: {
          type: "NODE",
          base: { type: "DATE", value: "2025-02-31" },
          offsets: [],
        },
        strict: false,
      }),
    );
    expect(msgAt(node(bad), ".condition.constraint.base.base.value")).toBe(
      '"2025-02-31" is not a valid calendar date (YYYY-MM-DD)',
    );
  });

  it("a non-object constraint is flagged", () => {
    expect(msgAt(node(gated(atom(null))), ".condition.constraint")).toBe(
      "expected a constraint, got null",
    );
  });

  it("a constraint whose reference base isn't a NODE is rejected", () => {
    // The gate's `base` must be a vesting NODE; a bare DURATION (or anything else)
    // is caught by validateVestingNode's structural guard.
    const bad = gated(
      atom({
        type: "BEFORE",
        base: { type: "DURATION", value: 6 },
        strict: false,
      }),
    );
    expect(msgAt(node(bad), ".condition.constraint.base")).toBe(
      'expected a NODE, got type "DURATION"',
    );
  });

  it("an AND/OR group with fewer than two items trips the arity rule", () => {
    const bad = gated({ type: "AND", items: [atom(okConstraint)] });
    expect(msgAt(node(bad), ".condition.items")).toBe(
      "must hold two or more conditions",
    );
  });

  it("a valid AND group with two items is clean", () => {
    const ok = gated({
      type: "AND",
      items: [atom(okConstraint), atom({ ...okConstraint, type: "AFTER" })],
    });
    expect(node(ok)).toEqual([]);
  });

  it("an unknown condition kind is named", () => {
    const bad = gated({ type: "XOR", items: [] });
    expect(msgAt(node(bad), ".condition")).toBe(
      'expected an ATOM, AND, or OR condition, got type "XOR"',
    );
  });

  it("a non-object condition is flagged", () => {
    expect(msgAt(node(gated("always")), ".condition")).toBe(
      "expected a condition, got string",
    );
  });
});

/* ------------------------
 * formatAstErrors
 * ------------------------ */

describe("formatAstErrors", () => {
  it("renders a root-path error as (root)", () => {
    const out = formatAstErrors([{ path: "", message: "broken" }]);
    expect(out).toBe("  - (root): broken");
  });

  it("renders a dotted path verbatim", () => {
    const out = formatAstErrors([
      { path: ".expr.periodicity.length", message: "bad" },
    ]);
    expect(out).toBe("  - .expr.periodicity.length: bad");
  });

  it("joins multiple errors one per line", () => {
    const out = formatAstErrors([
      { path: "a", message: "one" },
      { path: "b", message: "two" },
    ]);
    expect(out).toBe("  - a: one\n  - b: two");
  });
});
