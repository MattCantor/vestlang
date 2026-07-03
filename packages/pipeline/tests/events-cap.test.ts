import { describe, it, expect } from "vitest";
import { MAX_EVENTS } from "@vestlang/primitives";
import {
  runEvaluate,
  runAsOf,
  runVestedBetween,
  type GrantInput,
} from "../src/index.js";

// The evaluator's context guard throws on an oversized events map; the caught
// pipeline entries turn that throw into a structured { ok: false, error } Result
// rather than letting it escape.

const overCapGrant = (): GrantInput => ({
  grant_date: "2025-01-01",
  grant_quantity: 1000,
  events: Object.fromEntries(
    Array.from({ length: MAX_EVENTS + 1 }, (_, i) => [`e${i}`, "2024-01-01"]),
  ),
});

const SCHEDULE = "VEST OVER 12 months EVERY 1 month";

// The interpolated count and limit reach the Result message intact, distinct from
// the installment cap's own "exceeds the limit" line.
const overCapMessage = new RegExp(
  `${MAX_EVENTS + 1} entries, exceeds the limit of ${MAX_EVENTS}`,
);

describe("events-map cap through the pipeline", () => {
  it("runEvaluate refuses an over-cap events map as a structured error", () => {
    const r = runEvaluate(SCHEDULE, overCapGrant());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(overCapMessage);
  });

  it("runAsOf refuses an over-cap events map as a structured error", () => {
    const r = runAsOf(SCHEDULE, overCapGrant());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(overCapMessage);
  });

  it("runVestedBetween refuses an over-cap events map as a structured error", () => {
    const r = runVestedBetween(
      SCHEDULE,
      overCapGrant(),
      "2025-01-01",
      "2025-12-31",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(overCapMessage);
  });
});
