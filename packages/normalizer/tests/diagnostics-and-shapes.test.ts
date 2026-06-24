import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "../src/normalizer/index.js";
import type {
  AtomCondition,
  Diagnostic,
  OrCondition,
  Program,
} from "@vestlang/types";

// Companion to normalizer.test.ts, which pins the happy-path AST reshaping. This
// file covers the parts that suite skips and that are otherwise only tested from
// the linter (the diagnostic sink) or not at all (the marker strip): the sink
// wiring, the transient-marker cleanup, chained THEN tails, schedule-level
// selectors, and the OR side of the boolean path.

const norm = (src: string): Program => normalizeProgram(parse(src));

/** Run normalization with a sink and return everything it emitted. */
function diagnose(src: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  normalizeProgram(parse(src), (d) => out.push(d));
  return out;
}

const MIXED = `VEST FROM EVENT m BEFORE EVENT ipo OR BEFORE DATE 2026-01-01 AND AFTER DATE 2025-01-01 OVER 4 years EVERY 1 month`;

/* ------------------------
 * Diagnostic sink
 * ------------------------ */

describe("sink: duplicate-selector", () => {
  it("emits a warning naming the selector keyword", () => {
    expect(
      diagnose(
        `VEST FROM EARLIER OF (DATE 2025-01-01, DATE 2025-01-01)`,
      ).filter((d) => d.ruleId === "no-duplicate-selector-items"),
    ).toEqual([
      {
        ruleId: "no-duplicate-selector-items",
        severity: "warning",
        message: "EARLIER OF contains duplicate items",
        path: ["Program", 0],
      },
    ]);
  });

  it("stamps the diagnostic with the duplicate's own statement index", () => {
    // The dup lives in the second statement; the path must point at index 1, not 0.
    const flagged = diagnose(
      `VEST PLUS VEST FROM LATER OF (EVENT a, EVENT a)`,
    ).filter((d) => d.ruleId === "no-duplicate-selector-items");
    expect(flagged).toHaveLength(1);
    expect(flagged[0].path).toEqual(["Program", 1]);
    expect(flagged[0].message).toBe("LATER OF contains duplicate items");
  });

  it("stays silent on distinct arms", () => {
    expect(
      diagnose(
        `VEST FROM EARLIER OF (DATE 2025-01-01, DATE 2025-06-01)`,
      ).filter((d) => d.ruleId === "no-duplicate-selector-items"),
    ).toEqual([]);
  });

  it("dedupe happens with no sink too (it isn't gated on reporting)", () => {
    const out = norm(`VEST FROM EARLIER OF (EVENT a, EVENT a)`);
    const vs =
      out[0].expr.type === "SCHEDULE" ? out[0].expr.vesting_start : null;
    expect(vs?.type).toBe("NODE");
  });
});

describe("sink: mixed-boolean", () => {
  it("warns once on a bare mixed AND/OR, carrying the OR's source span", () => {
    const flagged = diagnose(MIXED).filter(
      (d) => d.ruleId === "no-implicit-mixed-boolean",
    );
    expect(flagged).toHaveLength(1);
    expect(flagged[0].severity).toBe("warning");
    expect(flagged[0].path).toEqual(["Program", 0]);
    expect(flagged[0].message).toMatch(/AND binds tighter than OR/);
    // cleanLoc keeps the line/column span and drops peggy's offset/source.
    expect(flagged[0].loc?.start.line).toBe(1);
    expect(typeof flagged[0].loc?.start.column).toBe("number");
    expect(flagged[0].loc).not.toHaveProperty("source");
    expect(flagged[0].loc).not.toHaveProperty("offset");
  });

  it("stays silent on a single operator", () => {
    expect(
      diagnose(
        `VEST FROM EVENT m BEFORE EVENT ipo AND AFTER DATE 2025-01-01 OVER 4 years EVERY 1 month`,
      ).filter((d) => d.ruleId === "no-implicit-mixed-boolean"),
    ).toEqual([]);
  });
});

/* ------------------------
 * Transient-marker strip
 * ------------------------ */

/** True when any nested object/array carries `key` as an own property. */
function deepHasKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((v) => deepHasKey(v, key));
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, key)) return true;
    return Object.values(value).some((v) => deepHasKey(v, key));
  }
  return false;
}

describe("transient parser markers don't leak onto the normalized tree", () => {
  it("strips mixedInfix (and the raw tree really had it, so the strip is doing work)", () => {
    const raw = parse(MIXED);
    // Positive control: the parser does flag the bare mix on the raw AST.
    expect(deepHasKey(raw, "mixedInfix")).toBe(true);

    const normalized = normalizeProgram(raw);
    expect(deepHasKey(normalized, "mixedInfix")).toBe(false);
    expect(deepHasKey(normalized, "grouped")).toBe(false);
  });

  it("strips `grouped` left by an explicit parenthesized group", () => {
    const src = `VEST FROM EVENT m (BEFORE EVENT ipo OR BEFORE DATE 2026-01-01) AND AFTER DATE 2025-01-01 OVER 4 years EVERY 1 month`;
    const raw = parse(src);
    expect(deepHasKey(raw, "grouped")).toBe(true);
    expect(deepHasKey(normalizeProgram(raw), "grouped")).toBe(false);
  });
});

/* ------------------------
 * Chained THEN tails
 * ------------------------ */

describe("chained tail normalization", () => {
  it("keeps the tail's start null and marks it chained", () => {
    const out = norm(
      `100 VEST FROM EVENT grant OVER 12 months EVERY 1 month THEN 200 VEST OVER 24 months EVERY 1 month`,
    );
    const tail = out[1];
    expect(tail.chained).toBe(true);
    expect(tail.expr.type).toBe("SCHEDULE");
    if (tail.expr.type !== "SCHEDULE")
      throw new Error("expected a SCHEDULE tail");
    // The tail has no start of its own — the resolver supplies the handoff date.
    expect(tail.expr.vesting_start).toBeNull();
  });

  it("normalizes a cliff inside the tail (duration → vestingStart node)", () => {
    const out = norm(
      `100 VEST FROM EVENT grant OVER 12 months EVERY 1 month THEN 200 VEST OVER 24 months EVERY 1 month CLIFF 6 months`,
    );
    const tail = out[1];
    if (tail.expr.type !== "SCHEDULE")
      throw new Error("expected a SCHEDULE tail");
    const cliff = tail.expr.periodicity.cliff;
    expect(cliff?.type).toBe("NODE");
    if (cliff?.type !== "NODE")
      throw new Error("expected a normalized NODE cliff");
    expect(cliff.base).toEqual({ type: "VESTING_START" });
    // Start still null even when the tail carries a cliff.
    expect(tail.expr.vesting_start).toBeNull();
  });
});

/* ------------------------
 * Schedule-level selectors
 * ------------------------ */

describe("schedule selectors: flatten, dedupe, collapse", () => {
  it("keeps two distinct schedule arms as a SCHEDULE_LATER_OF", () => {
    const out = norm(
      `VEST LATER START OF (FROM EVENT a OVER 12 months EVERY 1 month, FROM EVENT b OVER 24 months EVERY 1 month)`,
    );
    expect(out[0].expr.type).toBe("SCHEDULE_LATER_OF");
    if (out[0].expr.type !== "SCHEDULE_LATER_OF")
      throw new Error("expected a schedule selector");
    expect(out[0].expr.items).toHaveLength(2);
  });

  it("collapses identical schedule arms to a bare SCHEDULE and warns", () => {
    const src = `VEST LATER START OF (FROM EVENT a OVER 12 months EVERY 1 month, FROM EVENT a OVER 12 months EVERY 1 month)`;
    const out = norm(src);
    // Two identical arms dedupe to one, which then collapses out of the selector.
    expect(out[0].expr.type).toBe("SCHEDULE");

    const flagged = diagnose(src).filter(
      (d) => d.ruleId === "no-duplicate-selector-items",
    );
    expect(flagged).toHaveLength(1);
    expect(flagged[0].message).toBe("LATER START OF contains duplicate items");
  });
});

/* ------------------------
 * OR conditions (mirror of the AND coverage)
 * ------------------------ */

describe("OR conditions: flatten, dedupe, collapse", () => {
  function startCondition(src: string) {
    const out = norm(src);
    const expr = out[0].expr;
    if (expr.type !== "SCHEDULE" || expr.vesting_start?.type !== "NODE")
      throw new Error("expected a constrained single-schedule start");
    if (!expr.vesting_start.condition)
      throw new Error("expected the start to be gated");
    return expr.vesting_start.condition;
  }

  it("OR(BEFORE b, BEFORE b) collapses to a single ATOM", () => {
    const c = startCondition(
      `VEST FROM EVENT start BEFORE EVENT b OR BEFORE EVENT b`,
    );
    expect(c.type).toBe("ATOM");
    expect((c as AtomCondition).constraint.type).toBe("BEFORE");
  });

  it("flattens a nested OR in place to one three-item OR", () => {
    const c = startCondition(
      `VEST FROM EVENT start OR(BEFORE EVENT a, OR(BEFORE EVENT b, BEFORE EVENT c))`,
    );
    expect(c.type).toBe("OR");
    expect((c as OrCondition).items).toHaveLength(3);
    expect((c as OrCondition).items.every((x) => x.type === "ATOM")).toBe(true);
  });

  it("does not flatten across operators (AND under OR stays nested)", () => {
    const c = startCondition(
      `VEST FROM EVENT start OR(BEFORE EVENT a, AND(BEFORE EVENT b, BEFORE EVENT c))`,
    );
    expect(c.type).toBe("OR");
    const items = (c as OrCondition).items;
    expect(items).toHaveLength(2);
    expect(items.some((x) => x.type === "AND")).toBe(true);
  });
});
