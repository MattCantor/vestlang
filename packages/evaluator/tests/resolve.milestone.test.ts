// Issue #390 — a pure milestone (a slice that vests purely on an event, with no
// time schedule) lowers to a canonical statement that OMITS `schedule` entirely,
// rather than carrying a degenerate one-installment grid to satisfy the old flat
// shape. These tests pin the Decision-4 lowering predicate (`buildTemplate`):
// the schedule is omitted only when an event_condition is present AND there is no
// time cliff AND the grid is the degenerate one-lump (occurrences 1, period 0).
// All three clauses are load-bearing — a floored milestone (it carries a cliff)
// and a hybrid (it carries a real grid) both KEEP their schedule.

import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { compile } from "@vestlang/core";
import type { ResolutionContextInput } from "@vestlang/types";
import { resolveToCore } from "../src/resolve/index";

const ctx = (
  events: Record<string, string> = {},
  grantQuantity = 100000,
): ResolutionContextInput => ({
  grantDate: "2025-01-01",
  events,
  grantQuantity,
});

const lower = (dsl: string, events: Record<string, string> = {}) => {
  const result = resolveToCore(normalizeProgram(parse(dsl)), ctx(events));
  if (result.kind !== "template") {
    throw new Error(`expected a template for "${dsl}", got ${result.kind}`);
  }
  return result;
};

describe("milestone lowering — pure milestone omits the schedule (AC2)", () => {
  it("`VEST CLIFF EVENT ipo` lowers to event_condition only, no schedule", () => {
    const r = lower("VEST CLIFF EVENT ipo");
    expect(r.template.statements).toHaveLength(1);
    const s = r.template.statements[0];
    expect(s.event_condition).toEqual({ event_id: "ipo" });
    expect(s.schedule).toBeUndefined();
    // `schedule` is not merely undefined-valued — the key is absent on the wire.
    expect(Object.prototype.hasOwnProperty.call(s, "schedule")).toBe(false);
  });
});

describe("milestone lowering — dated event one-off lowers as a milestone (AC3)", () => {
  it("`VEST FROM DATE x CLIFF EVENT ipo` is schedule-less; startDate retained-but-inert", () => {
    const r = lower("VEST FROM DATE 2025-06-01 CLIFF EVENT ipo");
    const s = r.template.statements[0];
    expect(s.event_condition).toEqual({ event_id: "ipo" });
    expect(s.schedule).toBeUndefined();
    // The runtime still carries the FROM date even though the milestone has no grid
    // to anchor on it — it is retained but inert.
    expect(r.runtime.startDate).toBe("2025-06-01");
  });
});

describe("milestone lowering — a cliff keeps its schedule (AC4)", () => {
  it("`VEST CLIFF LATER OF (12 months, EVENT ipo)` keeps a schedule with the floor cliff + event_condition", () => {
    const r = lower("VEST CLIFF LATER OF (12 months, EVENT ipo)");
    const s = r.template.statements[0];
    // A floored milestone is NOT a schedule-less milestone: the time floor lives in
    // schedule.cliff, and the event hold rides alongside.
    expect(s.schedule).toBeDefined();
    expect(s.schedule?.cliff).toBeDefined();
    expect(s.event_condition).toEqual({ event_id: "ipo" });
  });
});

describe("milestone lowering — hybrid and DATE keep full schedules (AC5)", () => {
  it("AC5a — `VEST OVER 48 EVERY 1 CLIFF 12 months` keeps a full schedule with cliff, no event_condition", () => {
    const r = lower("VEST OVER 48 months EVERY 1 month CLIFF 12 months");
    const s = r.template.statements[0];
    expect(s.schedule?.occurrences).toBe(48);
    expect(s.schedule?.cliff).toBeDefined();
    expect(s.event_condition).toBeUndefined();
  });

  it("AC5a — `1000 VEST FROM DATE x` keeps a one-lump schedule, no event_condition", () => {
    const r = lower("1000 VEST FROM DATE 2025-06-01");
    const s = r.template.statements[0];
    expect(s.schedule).toBeDefined();
    expect(s.schedule?.occurrences).toBe(1);
    expect(s.event_condition).toBeUndefined();
  });

  it("AC5b (load-bearing) — `VEST OVER 48 EVERY 1 CLIFF EVENT ipo` keeps the FULL 48-occurrence schedule while carrying event_condition", () => {
    // The omission predicate keys on the degenerate grid SHAPE, not on
    // `(event_condition && !cliff)`. A 48-occurrence hybrid has an event_condition
    // and no time cliff, yet must KEEP its schedule — stripping it would silently
    // change the projection. This pins the grid-shape clause of the predicate.
    const r = lower("VEST OVER 48 months EVERY 1 month CLIFF EVENT ipo");
    const s = r.template.statements[0];
    expect(s.schedule).toBeDefined();
    expect(s.schedule?.occurrences).toBe(48);
    expect(s.schedule?.cliff).toBeUndefined();
    expect(s.event_condition).toEqual({ event_id: "ipo" });
  });
});

describe("milestone projection is byte-identical to the degenerate-grid path (AC6)", () => {
  // A milestone projects nothing while unfired, and folds the whole slice at the
  // firing date once the event arrives — exactly as the old one-installment grid
  // did. The schedule-less storage is eliminated only from STORAGE; the compiler
  // re-synthesizes the one-lump kernel inputs to fold the milestone.
  it("an unfired pure milestone projects nothing", () => {
    const r = lower("VEST CLIFF EVENT ipo"); // no firing in ctx
    expect(compile(r.template, r.totalShares, r.runtime)).toEqual([]);
  });

  it("a fired pure milestone folds the whole slice at the firing date", () => {
    const r = lower("VEST CLIFF EVENT ipo", { ipo: "2026-04-01" });
    expect(compile(r.template, r.totalShares, r.runtime)).toEqual([
      { date: "2026-04-01", amount: "100000" },
    ]);
  });

  it("a dated-event milestone folds the whole slice at the firing (FROM date inert)", () => {
    const r = lower("VEST FROM DATE 2025-06-01 CLIFF EVENT ipo", {
      ipo: "2026-04-01",
    });
    expect(compile(r.template, r.totalShares, r.runtime)).toEqual([
      { date: "2026-04-01", amount: "100000" },
    ]);
  });
});
