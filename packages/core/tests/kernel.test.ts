import { describe, it, expect } from "vitest";
import type { Fraction, OCTDate } from "@vestlang/types";
import {
  allocateEvents,
  expandGrid,
  gridDate,
  type GridCliff,
  type RawEvent,
} from "../src/kernel";

// Unit tests for the extracted share-allocation kernel. These exercise the
// primitives directly, before either engine is rewired onto them.

const frac = (numerator: number, denominator: number): Fraction => ({
  numerator,
  denominator,
});
const ONE = frac(1, 1);

// A standard self-anchored monthly schedule of the whole grant, parameterised by
// occurrence count and cliff. anchor == origin, day-of-month left to the default.
const grid = (
  occurrences: number,
  cliff: GridCliff,
  period = 1,
  anchor: OCTDate = "2025-01-01",
): RawEvent[] =>
  expandGrid({
    anchor,
    origin: anchor,
    period,
    periodType: "MONTHS",
    occurrences,
    stmtFraction: ONE,
    statementOrder: 1,
    dom: undefined,
    cliff,
  });

describe("expandGrid", () => {
  it("no cliff → an equal slice on every grid date", () => {
    expect(grid(4, { kind: "none" })).toEqual([
      {
        date: "2025-02-01",
        fractionOfGrant: frac(1, 4),
        statementOrder: 1,
        occurrence: 1,
      },
      {
        date: "2025-03-01",
        fractionOfGrant: frac(1, 4),
        statementOrder: 1,
        occurrence: 2,
      },
      {
        date: "2025-04-01",
        fractionOfGrant: frac(1, 4),
        statementOrder: 1,
        occurrence: 3,
      },
      {
        date: "2025-05-01",
        fractionOfGrant: frac(1, 4),
        statementOrder: 1,
        occurrence: 4,
      },
    ]);
  });

  it("a 25% one-year cliff lumps the first year, then 36 equal months", () => {
    const events = grid(48, {
      kind: "fixed",
      date: "2026-01-01",
      percentage: frac(1, 4),
    });
    expect(events).toHaveLength(37);
    // The lump leads, marked occurrence 0.
    expect(events[0]).toEqual({
      date: "2026-01-01",
      fractionOfGrant: frac(1, 4),
      statementOrder: 1,
      occurrence: 0,
    });
    // Each post-cliff month carries an equal share of the remaining three quarters.
    expect(events[1]).toEqual({
      date: "2026-02-01",
      fractionOfGrant: frac(1, 48),
      statementOrder: 1,
      occurrence: 13,
    });
  });

  it("an off-grid cliff lumps on its true date, post-cliff stays on the grid", () => {
    // Cliff on 2025-03-17, between the Mar 1 and Apr 1 grid points: Feb + Mar fold
    // into the lump, Apr + May split the rest.
    const events = grid(4, {
      kind: "fixed",
      date: "2025-03-17",
      percentage: frac(1, 2),
    });
    expect(events).toEqual([
      {
        date: "2025-03-17",
        fractionOfGrant: frac(1, 2),
        statementOrder: 1,
        occurrence: 0,
      },
      {
        date: "2025-04-01",
        fractionOfGrant: frac(1, 4),
        statementOrder: 1,
        occurrence: 3,
      },
      {
        date: "2025-05-01",
        fractionOfGrant: frac(1, 4),
        statementOrder: 1,
        occurrence: 4,
      },
    ]);
  });

  it("a proportional cliff derives its share from the grid (2 of 4 → a half)", () => {
    // No percentage given: the lump takes the fraction of occurrences at or before
    // the cliff. Two of four months precede 2025-03-17, so the lump is 1/2.
    const events = grid(4, { kind: "proportional", date: "2025-03-17" });
    expect(events[0]).toEqual({
      date: "2025-03-17",
      fractionOfGrant: frac(1, 2),
      statementOrder: 1,
      occurrence: 0,
    });
    expect(events.slice(1).map((e) => e.fractionOfGrant)).toEqual([
      frac(1, 4),
      frac(1, 4),
    ]);
  });

  it("a 100% cliff at the last grid date is the whole statement, one lump", () => {
    expect(
      grid(12, { kind: "fixed", date: "2026-01-01", percentage: ONE }),
    ).toEqual([
      {
        date: "2026-01-01",
        fractionOfGrant: ONE,
        statementOrder: 1,
        occurrence: 0,
      },
    ]);
  });

  it("a cliff on or before the start is no cliff — plain even grid, no lump", () => {
    // Both a cliff exactly on the anchor and one before it collapse to the even
    // grid: there's nothing for a past cliff to hold back.
    const onAnchor = grid(4, {
      kind: "fixed",
      date: "2025-01-01",
      percentage: frac(1, 4),
    });
    const beforeAnchor = grid(4, {
      kind: "fixed",
      date: "2024-12-01",
      percentage: frac(1, 4),
    });
    const evenGrid = grid(4, { kind: "none" });
    expect(onAnchor).toEqual(evenGrid);
    expect(beforeAnchor).toEqual(evenGrid);
    // No occurrence-0 lump in sight.
    expect(onAnchor.some((e) => e.occurrence === 0)).toBe(false);
  });

  it("zero-spacing grid with a cliff on the start → even grid, nothing dropped", () => {
    // period 0 puts every occurrence on the start date, and a zero-length cliff
    // lands there too. The cliff is on the anchor, so it's treated as no cliff and
    // the full grant still vests across the four (same-date) occurrences — the
    // remainder is NOT lost.
    const events = grid(
      4,
      {
        kind: "fixed",
        date: "2025-01-01",
        percentage: frac(1, 4),
      },
      0,
    );
    expect(events).toEqual([
      {
        date: "2025-01-01",
        fractionOfGrant: frac(1, 4),
        statementOrder: 1,
        occurrence: 1,
      },
      {
        date: "2025-01-01",
        fractionOfGrant: frac(1, 4),
        statementOrder: 1,
        occurrence: 2,
      },
      {
        date: "2025-01-01",
        fractionOfGrant: frac(1, 4),
        statementOrder: 1,
        occurrence: 3,
      },
      {
        date: "2025-01-01",
        fractionOfGrant: frac(1, 4),
        statementOrder: 1,
        occurrence: 4,
      },
    ]);
    expect(allocateEvents(events, 400).reduce((a, e) => a + e.amount, 0)).toBe(
      400,
    );
  });
});

describe("gridDate", () => {
  it("springs an end-of-month start back to the month-end across short months", () => {
    const at = gridDate({
      anchor: "2025-01-31",
      origin: "2025-01-31",
      period: 1,
      periodType: "MONTHS",
      dom: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    });
    expect([at(1), at(2), at(3)]).toEqual([
      "2025-02-28",
      "2025-03-31",
      "2025-04-30",
    ]);
  });
});

describe("allocateEvents", () => {
  it("telescopes a 25% cliff schedule to exactly the grant", () => {
    const events = grid(48, {
      kind: "fixed",
      date: "2026-01-01",
      percentage: frac(1, 4),
    });
    const out = allocateEvents(events, 100000);
    expect(out).toHaveLength(37);
    expect(out[0]).toEqual({ date: "2026-01-01", amount: 25000 });
    expect(out.reduce((a, e) => a + e.amount, 0)).toBe(100000);
  });

  it("matches the off-grid lump's share counts", () => {
    const events = grid(4, {
      kind: "fixed",
      date: "2025-03-17",
      percentage: frac(1, 2),
    });
    expect(allocateEvents(events, 400)).toEqual([
      { date: "2025-03-17", amount: 200 },
      { date: "2025-04-01", amount: 100 },
      { date: "2025-05-01", amount: 100 },
    ]);
  });

  it("drops events that round to nothing", () => {
    // Four quarter-shares against a single share: only the final one clears zero.
    const events = grid(4, { kind: "none" });
    expect(allocateEvents(events, 1)).toEqual([
      { date: "2025-05-01", amount: 1 },
    ]);
  });

  it("folds amounts dated before the grant date onto it", () => {
    const events: RawEvent[] = [
      {
        date: "2025-02-01",
        fractionOfGrant: frac(1, 3),
        statementOrder: 1,
        occurrence: 1,
      },
      {
        date: "2025-03-01",
        fractionOfGrant: frac(1, 3),
        statementOrder: 1,
        occurrence: 2,
      },
      {
        date: "2025-04-01",
        fractionOfGrant: frac(1, 3),
        statementOrder: 1,
        occurrence: 3,
      },
    ];
    // Feb + Mar predate the 2025-03-15 grant and aggregate onto it; Apr passes through.
    expect(allocateEvents(events, 300, "2025-03-15")).toEqual([
      { date: "2025-03-15", amount: 200 },
      { date: "2025-04-01", amount: 100 },
    ]);
  });
});
