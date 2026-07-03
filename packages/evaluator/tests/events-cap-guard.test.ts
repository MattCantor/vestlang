import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { MAX_EVENTS } from "@vestlang/primitives";
import type { AsOfContextInput } from "@vestlang/types";
import { evaluateProgram } from "../src/index.js";

// The events map is bounded at context creation, on the same funnel that
// calendar-validates the dates. Every evaluator entry routes through
// createEvaluationContext, so an oversized map is refused up front rather than
// walked entry by entry.

const prog = (dsl: string) => normalizeProgram(parse(dsl));
const SCHEDULE = "VEST OVER 12 months EVERY 1 month";

const ctx = (events: Record<string, string | undefined>): AsOfContextInput => ({
  grantDate: "2025-01-01",
  events,
  grantQuantity: 1000,
  asOf: "2026-06-01",
});

const eventsOfSize = (n: number, date: string): Record<string, string> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`e${i}`, date]));

// Pins the message's interpolated count and limit — not the bare "exceeds the
// limit" phrase, which the installment cap shares verbatim.
const overCapMessage = new RegExp(
  `${MAX_EVENTS + 1} entries, exceeds the limit of ${MAX_EVENTS}`,
);

describe("events-map cap at the evaluator boundary", () => {
  it("rejects an events map over the cap, naming the limit", () => {
    expect(() =>
      evaluateProgram(
        prog(SCHEDULE),
        ctx(eventsOfSize(MAX_EVENTS + 1, "2024-01-01")),
      ),
    ).toThrow(overCapMessage);
  });

  it("accepts an events map exactly at the cap", () => {
    expect(() =>
      evaluateProgram(
        prog(SCHEDULE),
        ctx(eventsOfSize(MAX_EVENTS, "2024-01-01")),
      ),
    ).not.toThrow();
  });

  it("the count guard precedes date validation", () => {
    // An over-cap map whose entries are ALL invalid dates must fail on the count,
    // not the dates — proof the size check runs before the per-entry date walk. A
    // valid-date over-cap map can't tell the two orderings apart.
    let message = "";
    try {
      evaluateProgram(
        prog(SCHEDULE),
        ctx(eventsOfSize(MAX_EVENTS + 1, "not-a-date")),
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(overCapMessage);
    expect(message).not.toMatch(/calendar date/);
  });
});
