import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import type { AsOfContextInput } from "@vestlang/types";
import { evaluateProgram, evaluateProgramAsOf } from "../src/index.js";

// #327: the context's dates are calendar-validated once, at context creation,
// with the same `isValidCalendarDate` guard every other input boundary shares.
// Every evaluator entry funnels through createEvaluationContext, so an impossible
// date (one the bare regex lets through, like "2025-02-31") fails loud with an
// input-shaped message instead of silently rolling forward inside date arithmetic.

const prog = (dsl: string) => normalizeProgram(parse(dsl));

// A valid baseline context; tests override one field at a time.
const ctx = (over: Partial<AsOfContextInput> = {}): AsOfContextInput => ({
  grantDate: "2025-01-01",
  events: {},
  grantQuantity: 1000,
  asOf: "2026-06-01",
  ...over,
});

const SCHEDULE = "VEST OVER 12 months EVERY 1 month";

describe("context-date guard at the evaluator boundary", () => {
  it("rejects an impossible grantDate", () => {
    expect(() =>
      evaluateProgram(prog(SCHEDULE), ctx({ grantDate: "2025-02-31" })),
    ).toThrow(/grantDate: must be a real calendar date/);
  });

  it("rejects a fired event whose date is impossible, naming the event key", () => {
    expect(() =>
      evaluateProgram(prog(SCHEDULE), ctx({ events: { ipo: "2025-13-01" } })),
    ).toThrow(/events\.ipo: must be a real calendar date/);
  });

  it("leaves an unfired event (undefined) legal — no throw", () => {
    expect(() =>
      evaluateProgram(prog(SCHEDULE), ctx({ events: { ipo: undefined } })),
    ).not.toThrow();
  });

  it("rejects an impossible asOf via evaluateProgramAsOf", () => {
    expect(() =>
      evaluateProgramAsOf(prog(SCHEDULE), ctx({ asOf: "2025-02-31" })),
    ).toThrow(/asOf: must be a real calendar date/);
  });

  it("an absent/undefined asOf is not policed by this guard", () => {
    // The non-as-of entry never supplies asOf; reading it structurally yields
    // undefined, which the guard leaves alone (required-ness is a separate concern).
    const noAsOf = ctx();
    delete (noAsOf as { asOf?: string }).asOf;
    expect(() => evaluateProgram(prog(SCHEDULE), noAsOf)).not.toThrow();
  });

  it("accepts an all-valid context", () => {
    expect(() =>
      evaluateProgramAsOf(
        prog(SCHEDULE),
        ctx({ events: { ipo: "2025-06-01" } }),
      ),
    ).not.toThrow();
  });

  // --- Aggregation: collect-then-throw, not fail-fast on the first bad field ---

  it("a valid grantDate (first-checked) plus a bad later field still names the later field", () => {
    // grantDate is checked first and is valid; the message must reach past it
    // to name events.ipo — proof the guard doesn't stop at the first field.
    expect(() =>
      evaluateProgram(prog(SCHEDULE), ctx({ events: { ipo: "2025-13-01" } })),
    ).toThrow(/events\.ipo/);
  });

  it("two bad fields produce ONE message naming both (aggregate, not fail-fast)", () => {
    let message = "";
    try {
      evaluateProgramAsOf(
        prog(SCHEDULE),
        ctx({ events: { ipo: "2025-13-01" }, asOf: "2025-02-31" }),
      );
    } catch (e) {
      message = (e as Error).message;
    }
    // A single thrown message that names BOTH labels is what distinguishes
    // aggregate-then-throw from throwing on the first bad field.
    expect(message).toMatch(/events\.ipo/);
    expect(message).toMatch(/asOf/);
  });

  // --- Behavioral parity with isValidCalendarDate ---

  it("a real leap date (2024-02-29) is legal — no throw", () => {
    expect(() =>
      evaluateProgram(prog(SCHEDULE), ctx({ grantDate: "2024-02-29" })),
    ).not.toThrow();
  });

  it.each(["2025-02-31", "2025-13-01", "2025-00-00", "0000-01-01"])(
    "rejects the impossible date %s",
    (bad) => {
      expect(() =>
        evaluateProgram(prog(SCHEDULE), ctx({ grantDate: bad })),
      ).toThrow(/grantDate: must be a real calendar date/);
    },
  );

  it('carries the (got "<value>") suffix in the message', () => {
    expect(() =>
      evaluateProgram(prog(SCHEDULE), ctx({ grantDate: "2025-02-31" })),
    ).toThrow(
      /grantDate: must be a real calendar date \(YYYY-MM-DD\) \(got "2025-02-31"\)/,
    );
  });

  // --- Both entry paths enforce it ---

  it("evaluateProgram (no-asOf path) enforces grantDate validity", () => {
    expect(() =>
      evaluateProgram(prog(SCHEDULE), ctx({ grantDate: "2025-13-01" })),
    ).toThrow(/grantDate: must be a real calendar date/);
  });

  it("evaluateProgramAsOf (as-of path) enforces asOf validity", () => {
    expect(() =>
      evaluateProgramAsOf(prog(SCHEDULE), ctx({ asOf: "2025-13-01" })),
    ).toThrow(/asOf: must be a real calendar date/);
  });
});
