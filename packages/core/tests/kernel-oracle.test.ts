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

// A degenerate-but-reachable schedule: zero spacing (period 0, every occurrence on
// the start date) under a zero-length cliff (so the cliff also lands on the start).
// A duration cliff now owns its stated percentage at the start rather than being
// waved through as a no-op. With nothing strictly after the cliff, a sub-100%
// percentage has no remainder to vest, so the compiler refuses loudly; only a 100%
// cliff (which keeps the whole grant) is placeable. (Originally #90 dropped the
// (1 − pct) silently — neither the old silent drop nor the later silent even-grid.)
describe("kernel oracle — zero-spacing cliff on the start (#90)", () => {
  const zeroSpacing = (
    numerator: number,
    denominator: number,
  ): VestingScheduleTemplate => ({
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
          percentage: { numerator, denominator },
        },
        percentage: { numerator: 1, denominator: 1 },
      },
    ],
  });
  const runtime: VestingRuntime = { startDate: "2025-01-01" };

  it("a sub-100% cliff has no remainder to vest → throws, not a silent drop", () => {
    expect(() => compile(zeroSpacing(1, 4), 400, runtime)).toThrow(
      /percentage < 1 leaves no occurrence after the cliff date/,
    );
  });

  it("a 100% cliff is placeable — one full-grant lump, nothing dropped", () => {
    expect(compile(zeroSpacing(1, 1), 400, runtime)).toEqual([
      { date: "2025-01-01", amount: "400" },
    ]);
    expect(sum(compile(zeroSpacing(1, 1), 400, runtime))).toBe(400);
  });
});
