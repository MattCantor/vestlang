import { describe, it, expect } from "vitest";
import { compile } from "../src/compile";
import type { VestingRuntime, VestingScheduleTemplate } from "@vestlang/types";

// Frozen oracle for the share-allocation kernel (issue #85), core-side cases.
//
// The compiler in this package and the evaluator's runtime resolver currently
// carry two hand-kept copies of the same grid/cliff/allocation math. An upcoming
// refactor pulls that math into one shared primitive and rewires both onto it.
// These tests pin the current numbers so that refactor is provably output-
// preserving — every case here must keep producing identical {date, amount}
// tranches afterwards, with a single marked exception called out below.

const sum = (events: { amount: string }[]): number =>
  events.reduce((acc, e) => acc + Number(e.amount), 0);

describe("kernel oracle — event payout scaled by a realized fraction", () => {
  // A milestone-style grant that only partially pays out: the event fires but
  // delivers 30% of the shares, spread over a year of monthly vesting. The 30%
  // is applied to every installment's slice. The later refactor folds that 30%
  // into each slice up front instead of multiplying at the end; the dated output
  // it produces has to match this exactly.
  const template: VestingScheduleTemplate = {
    id: "milestone",
    statements: [
      {
        order: 1,
        vesting_base: { type: "EVENT", event_id: "milestone" },
        occurrences: 12,
        period: 1,
        period_type: "MONTHS",
        percentage: { numerator: 1, denominator: 1 },
      },
    ],
  };

  const events = compile(template, 1200, {
    eventFirings: [
      {
        event_id: "milestone",
        date: "2026-04-01",
        realized_fraction: { numerator: 3, denominator: 10 },
      },
    ],
  });

  it("vests 30% of the grant — 360 of 1200 shares", () => {
    expect(sum(events)).toBe(360);
  });

  it("spreads the 360 evenly over twelve months from the firing date", () => {
    expect(events).toEqual([
      { date: "2026-05-01", amount: "30" },
      { date: "2026-06-01", amount: "30" },
      { date: "2026-07-01", amount: "30" },
      { date: "2026-08-01", amount: "30" },
      { date: "2026-09-01", amount: "30" },
      { date: "2026-10-01", amount: "30" },
      { date: "2026-11-01", amount: "30" },
      { date: "2026-12-01", amount: "30" },
      { date: "2027-01-01", amount: "30" },
      { date: "2027-02-01", amount: "30" },
      { date: "2027-03-01", amount: "30" },
      { date: "2027-04-01", amount: "30" },
    ]);
  });
});

// Issue #90, now fixed. A degenerate-but-valid schedule: zero spacing (period 0,
// so every occurrence lands on the start date) and a zero-length cliff (so the
// cliff also falls on the start date). A cliff that has already arrived by the
// time vesting starts holds nothing back, so it's treated as no cliff and the
// whole grant still vests across the (same-date) occurrences. The compiler used
// to emit only the 25% lump and drop the other 75%; it no longer does.
describe("kernel oracle — zero-spacing cliff on the start vests the full grant (#90)", () => {
  const template: VestingScheduleTemplate = {
    id: "period-0-cliff",
    statements: [
      {
        order: 1,
        vesting_base: { type: "DATE" },
        occurrences: 4,
        period: 0, // every occurrence lands on the start date
        period_type: "MONTHS",
        cliff: {
          length: 0, // cliff also on the start date
          period_type: "MONTHS",
          percentage: { numerator: 1, denominator: 4 }, // 25%
        },
        percentage: { numerator: 1, denominator: 1 },
      },
    ],
  };
  const runtime: VestingRuntime = { startDate: "2025-01-01" };

  it("vests the four equal occurrences on the start date", () => {
    expect(compile(template, 400, runtime)).toEqual([
      { date: "2025-01-01", amount: "100" },
      { date: "2025-01-01", amount: "100" },
      { date: "2025-01-01", amount: "100" },
      { date: "2025-01-01", amount: "100" },
    ]);
  });

  it("vests the whole grant — 400 of 400 shares, nothing dropped", () => {
    expect(sum(compile(template, 400, runtime))).toBe(400);
  });
});
