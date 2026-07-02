import { describe, it, expect } from "vitest";
import type { Fraction, OCTDate } from "@vestlang/types";
import type { BigRational } from "@vestlang/utils";
import {
  allocateEvents,
  allocateWithProvenance,
  expandGrid,
  gridDate,
  type GridCliff,
  type RawEvent,
} from "../src/kernel";

// Unit tests for the extracted share-allocation kernel. These exercise the
// primitives directly, before either engine is rewired onto them.

// `frac` builds the Number-backed Fraction the statement share and cliff
// percentage arrive as (they widen to BigInt inside expandGrid). `bfrac` builds
// the BigInt-exact BigRational a RawEvent's fractionOfGrant now carries.
const frac = (numerator: number, denominator: number): Fraction => ({
  numerator,
  denominator,
});
const bfrac = (numerator: number, denominator: number): BigRational => ({
  numerator: BigInt(numerator),
  denominator: BigInt(denominator),
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
        fractionOfGrant: bfrac(1, 4),
        statementOrder: 1,
        occurrence: 1,
      },
      {
        date: "2025-03-01",
        fractionOfGrant: bfrac(1, 4),
        statementOrder: 1,
        occurrence: 2,
      },
      {
        date: "2025-04-01",
        fractionOfGrant: bfrac(1, 4),
        statementOrder: 1,
        occurrence: 3,
      },
      {
        date: "2025-05-01",
        fractionOfGrant: bfrac(1, 4),
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
      fractionOfGrant: bfrac(1, 4),
      statementOrder: 1,
      occurrence: 0,
    });
    // Each post-cliff month carries an equal share of the remaining three quarters.
    expect(events[1]).toEqual({
      date: "2026-02-01",
      fractionOfGrant: bfrac(1, 48),
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
        fractionOfGrant: bfrac(1, 2),
        statementOrder: 1,
        occurrence: 0,
      },
      {
        date: "2025-04-01",
        fractionOfGrant: bfrac(1, 4),
        statementOrder: 1,
        occurrence: 3,
      },
      {
        date: "2025-05-01",
        fractionOfGrant: bfrac(1, 4),
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
      fractionOfGrant: bfrac(1, 2),
      statementOrder: 1,
      occurrence: 0,
    });
    expect(events.slice(1).map((e) => e.fractionOfGrant)).toEqual([
      bfrac(1, 4),
      bfrac(1, 4),
    ]);
  });

  it("a 100% cliff at the last grid date is the whole statement, one lump", () => {
    expect(
      grid(12, { kind: "fixed", date: "2026-01-01", percentage: ONE }),
    ).toEqual([
      {
        date: "2026-01-01",
        fractionOfGrant: bfrac(1, 1),
        statementOrder: 1,
        occurrence: 0,
      },
    ]);
  });

  it("a fixed cliff on the start date honors its percentage — lump leads the grid", () => {
    // A duration cliff that lands exactly on the anchor still owns its stated
    // percentage: a 25% lump on the start, then 75% over the four occurrences.
    const events = grid(4, {
      kind: "fixed",
      date: "2025-01-01",
      percentage: frac(1, 4),
    });
    expect(events).toEqual([
      {
        date: "2025-01-01",
        fractionOfGrant: bfrac(1, 4),
        statementOrder: 1,
        occurrence: 0,
      },
      {
        date: "2025-02-01",
        fractionOfGrant: bfrac(3, 16),
        statementOrder: 1,
        occurrence: 1,
      },
      {
        date: "2025-03-01",
        fractionOfGrant: bfrac(3, 16),
        statementOrder: 1,
        occurrence: 2,
      },
      {
        date: "2025-04-01",
        fractionOfGrant: bfrac(3, 16),
        statementOrder: 1,
        occurrence: 3,
      },
      {
        date: "2025-05-01",
        fractionOfGrant: bfrac(3, 16),
        statementOrder: 1,
        occurrence: 4,
      },
    ]);
  });

  it("a fixed cliff before the first installment honors its percentage (#254)", () => {
    // Cliff 10 days in (2025-01-11), before the first Feb 1 occurrence: the 25%
    // lump lands on its own date, then 75% over all four months. Previously this
    // silently dropped the percentage and returned the even grid.
    const events = expandGrid({
      anchor: "2025-01-01",
      origin: "2025-01-01",
      period: 1,
      periodType: "MONTHS",
      occurrences: 4,
      stmtFraction: ONE,
      statementOrder: 1,
      dom: undefined,
      cliff: { kind: "fixed", date: "2025-01-11", percentage: frac(1, 4) },
    });
    expect(events[0]).toEqual({
      date: "2025-01-11",
      fractionOfGrant: bfrac(1, 4),
      statementOrder: 1,
      occurrence: 0,
    });
    expect(events.slice(1).map((e) => e.fractionOfGrant)).toEqual([
      bfrac(3, 16),
      bfrac(3, 16),
      bfrac(3, 16),
      bfrac(3, 16),
    ]);
  });

  it("an event cliff before the first installment stays an even grid (proportional)", () => {
    // A fired event cliff takes only what the grid accrued by its date. None has
    // by 2025-01-11, so there's no lump — the plain even grid, no spurious zero.
    const events = grid(4, { kind: "proportional", date: "2025-01-11" });
    expect(events).toEqual(grid(4, { kind: "none" }));
    expect(events.some((e) => e.occurrence === 0)).toBe(false);
  });

  it("a fixed cliff with pct < 1 swallowing a zero-spacing grid throws", () => {
    // period 0 puts every occurrence on the start date, so nothing lands strictly
    // after a cliff on the start. A 25% cliff has 75% with nowhere to vest →
    // refuse loudly rather than drop it.
    expect(() =>
      grid(4, { kind: "fixed", date: "2025-01-01", percentage: frac(1, 4) }, 0),
    ).toThrow(/percentage < 1 leaves no occurrence after the cliff date/);
  });

  it("a 100% fixed cliff swallowing a zero-spacing grid honors as one lump", () => {
    // Same zero-spacing grid, but a full-grant cliff has no remainder, so it lands
    // as one 100% lump on the start — no throw.
    const events = grid(
      4,
      { kind: "fixed", date: "2025-01-01", percentage: ONE },
      0,
    );
    expect(events).toEqual([
      {
        date: "2025-01-01",
        fractionOfGrant: bfrac(1, 1),
        statementOrder: 1,
        occurrence: 0,
      },
    ]);
    expect(allocateEvents(events, 400).reduce((a, e) => a + e.amount, 0)).toBe(
      400,
    );
  });

  it("a fixed cliff dated before the anchor throws", () => {
    // The fixed cliff is pinned at 2025-01-05, before the 2025-01-15 anchor; under
    // FIRST_DAY_OF_MONTH the grid itself also lands earlier in the month. Either
    // way the cliff falls before the vesting start, where nothing can vest.
    expect(() =>
      expandGrid({
        anchor: "2025-01-15",
        origin: "2025-01-15",
        period: 1,
        periodType: "MONTHS",
        occurrences: 4,
        stmtFraction: ONE,
        statementOrder: 1,
        dom: "FIRST_DAY_OF_MONTH",
        cliff: { kind: "fixed", date: "2025-01-05", percentage: frac(1, 4) },
      }),
    ).toThrow(/falls before the statement's start/);
  });
});

describe("gridDate", () => {
  it("springs an end-of-month start back to the month-end across short months", () => {
    const at = gridDate({
      anchor: "2025-01-31",
      origin: "2025-01-31",
      period: 1,
      periodType: "MONTHS",
      dom: "VESTING_START_DAY",
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
        fractionOfGrant: bfrac(1, 3),
        statementOrder: 1,
        occurrence: 1,
      },
      {
        date: "2025-03-01",
        fractionOfGrant: bfrac(1, 3),
        statementOrder: 1,
        occurrence: 2,
      },
      {
        date: "2025-04-01",
        fractionOfGrant: bfrac(1, 3),
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

  it("never allocates more than the grant when two statements emit on the grant date", () => {
    // Two half-grant statements, both firing on the grant date (#144 repro:
    // `0.5 VEST PLUS 0.5 VEST`). They stay separate entries, so the fold must
    // not re-emit the first half against the second.
    const events: RawEvent[] = [
      {
        date: "2025-02-01",
        fractionOfGrant: bfrac(1, 2),
        statementOrder: 1,
        occurrence: 1,
      },
      {
        date: "2025-02-01",
        fractionOfGrant: bfrac(1, 2),
        statementOrder: 2,
        occurrence: 1,
      },
    ];
    const out = allocateEvents(events, 1000, "2025-02-01");
    expect(out).toEqual([
      { date: "2025-02-01", amount: 500 },
      { date: "2025-02-01", amount: 500 },
    ]);
    expect(out.reduce((a, e) => a + e.amount, 0)).toBe(1000);
  });

  it("never allocates more than the grant total (invariant)", () => {
    // Stack several statements landing on and around the grant date; the
    // emitted installments must telescope to at most the grant.
    const total = 1000;
    const events: RawEvent[] = [
      {
        date: "2025-01-01",
        fractionOfGrant: bfrac(1, 4),
        statementOrder: 1,
        occurrence: 1,
      },
      {
        date: "2025-02-01",
        fractionOfGrant: bfrac(1, 4),
        statementOrder: 1,
        occurrence: 2,
      },
      {
        date: "2025-02-01",
        fractionOfGrant: bfrac(1, 4),
        statementOrder: 2,
        occurrence: 1,
      },
      {
        date: "2025-03-01",
        fractionOfGrant: bfrac(1, 4),
        statementOrder: 1,
        occurrence: 3,
      },
    ];
    const out = allocateEvents(events, total, "2025-02-01");
    const sum = out.reduce((a, e) => a + e.amount, 0);
    expect(sum).toBeLessThanOrEqual(total);
  });

  // At extreme grant sizes the fraction denominators (grant × occurrences) run
  // past 2^53. Before the fraction layer moved to BigInt these rounded
  // silently: the first month of a 999,999,999,999,989-share grant vanished and
  // a 123,456,789,012,345-share grant summed one share short.
  it("a near-2^50 grant over 48 months loses no share", () => {
    const total = 999_999_999_999_989;
    const out = allocateEvents(grid(48, { kind: "none" }), total);
    expect(out).toHaveLength(48);
    expect(out[0].amount).toBeGreaterThan(0);
    expect(out.reduce((a, e) => a + e.amount, 0)).toBe(total);
  });

  it("a 123456789012345-share grant over 37 months sums exactly", () => {
    const total = 123_456_789_012_345;
    const out = allocateEvents(grid(37, { kind: "none" }), total);
    expect(out.reduce((a, e) => a + e.amount, 0)).toBe(total);
  });

  // The cases above feed events that grid() already emits in (date, order,
  // occurrence) order, so a broken sort comparator goes unnoticed. These feed
  // scrambled input and pin that the comparator restores the canonical order
  // before the single cumulative walk — the ordering is load-bearing, since the
  // walk telescopes in sequence and a cliff lump must lead its day.
  it("sorts scrambled events by date, then statement order, before allocating", () => {
    const events: RawEvent[] = [
      {
        date: "2025-03-01",
        fractionOfGrant: bfrac(1, 6),
        statementOrder: 1,
        occurrence: 1,
      },
      {
        date: "2025-02-01", // same day as the next, higher statement order
        fractionOfGrant: bfrac(1, 3),
        statementOrder: 2,
        occurrence: 1,
      },
      {
        date: "2025-02-01",
        fractionOfGrant: bfrac(1, 2),
        statementOrder: 1,
        occurrence: 1,
      },
    ];
    // Canonical order: Feb(½, stmt 1), Feb(⅓, stmt 2), Mar(⅙). Cumulative
    // round-down over 600: 300, then 500−300=200, then 600−500=100.
    expect(allocateEvents(events, 600)).toEqual([
      { date: "2025-02-01", amount: 300 },
      { date: "2025-02-01", amount: 200 },
      { date: "2025-03-01", amount: 100 },
    ]);
  });

  it("breaks a same-date, same-statement tie by occurrence (a cliff lump leads)", () => {
    const events: RawEvent[] = [
      {
        date: "2025-02-01",
        fractionOfGrant: bfrac(1, 3),
        statementOrder: 1,
        occurrence: 5,
      },
      {
        date: "2025-02-01", // a cliff lump (occurrence 0) must lead its day
        fractionOfGrant: bfrac(2, 3),
        statementOrder: 1,
        occurrence: 0,
      },
    ];
    // Canonical order: occ 0 (⅔)=200 leads, occ 5 (⅓)=100 follows.
    expect(allocateEvents(events, 300)).toEqual([
      { date: "2025-02-01", amount: 200 },
      { date: "2025-02-01", amount: 100 },
    ]);
  });
});

// #442: allocateWithProvenance must agree with allocateEvents on the headline,
// byte for byte, and its per-event provenance must conserve the same total.
describe("allocateWithProvenance", () => {
  // A spread of event bags: a plain grid, a mixed multi-statement same-date bag,
  // a non-divisible split, and a backdated grid that folds onto the grant date.
  const bags: {
    label: string;
    events: RawEvent[];
    total: number;
    grant?: OCTDate;
  }[] = [
    { label: "plain 4-grid", events: grid(4, { kind: "none" }), total: 1000 },
    {
      label: "non-divisible 3-grid",
      events: grid(3, { kind: "none" }),
      total: 100,
    },
    {
      label: "two same-date statements",
      events: [
        {
          date: "2025-02-01",
          fractionOfGrant: bfrac(1, 3),
          statementOrder: 1,
          occurrence: 1,
        },
        {
          date: "2025-02-01",
          fractionOfGrant: bfrac(1, 3),
          statementOrder: 2,
          occurrence: 1,
        },
        {
          date: "2025-02-01",
          fractionOfGrant: bfrac(1, 3),
          statementOrder: 3,
          occurrence: 1,
        },
      ],
      total: 100,
    },
    {
      label: "backdated grid folding onto the grant date",
      events: grid(6, { kind: "none" }, 1, "2024-10-01"),
      total: 600,
      grant: "2025-01-01",
    },
  ];

  for (const { label, events, total, grant } of bags) {
    it(`agrees with allocateEvents and conserves the total: ${label}`, () => {
      const prov = allocateWithProvenance(events, total, grant);
      // The headline is byte-identical to allocateEvents.
      expect(prov.installments).toEqual(allocateEvents(events, total, grant));
      // The contributions conserve the same total.
      const sum = (xs: { amount: number }[]) =>
        xs.reduce((a, x) => a + x.amount, 0);
      expect(sum(prov.contributions)).toBe(sum(prov.installments));
      // Every contribution carries its source statement and a folded date (no
      // contribution sits before the grant date).
      if (grant !== undefined) {
        for (const c of prov.contributions) expect(c.date >= grant).toBe(true);
      }
    });
  }
});
