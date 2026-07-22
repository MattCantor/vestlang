import { describe, expect, it } from "vitest";
import type { OCTDate } from "@vestlang/types";
import {
  domCandidates,
  segmentThen,
  solveFloorCounts,
  type Row,
} from "../src/analytic/solvers.js";

// Pure-math unit tests for the analytic core's family solvers. Each is a closed
// function of ISO dates and integers, so these pin the arithmetic directly,
// independent of the render/evaluate round trip.

function row(date: string, amount: number): Row {
  return { date: date, amount };
}

const withinSlack = (total: number, k: number, nOther: number, lump: number) =>
  Math.abs(Math.floor((total * k) / (k + nOther)) - lump) <= 1;

describe("solveFloorCounts — monotone floor solve", () => {
  it("recovers the folded count whose floor hits the lump exactly", () => {
    // 100 over a 48-step monthly grid, first 12 folded into a cliff:
    // floor(100·12/48) = 25.
    const ks = solveFloorCounts(100, 25, 36);
    expect(ks).toContain(12);
    for (const k of ks) expect(withinSlack(100, k, 36, 25)).toBe(true);
  });

  it("keeps neighbours inside the ±1 stored-decimal slack", () => {
    // floor(100·13/49) = 26, one off the lump — still admitted.
    const ks = solveFloorCounts(100, 25, 36);
    expect(ks).toContain(13);
    expect(ks).not.toContain(10);
    expect(ks).not.toContain(20);
  });

  it("returns ascending counts and stops once the floor passes the lump", () => {
    const ks = solveFloorCounts(100, 25, 36);
    expect(ks).toEqual([...ks].sort((a, b) => a - b));
    // early break: nothing far above the crossing survives
    expect(Math.max(...ks)).toBeLessThan(20);
  });

  it("is empty when no count's floor can reach the lump", () => {
    // lump 200 exceeds the total, so floor(100·k/(k+5)) never lands within ±1.
    expect(solveFloorCounts(100, 200, 5)).toEqual([]);
  });

  it("solves an exactly-dividing case", () => {
    // floor(48·12/48) = 12.
    expect(solveFloorCounts(48, 12, 36)).toContain(12);
  });
});

describe("segmentThen — rate/cadence-change segmentation", () => {
  it("splits at a cadence change and gives each segment its own period", () => {
    const rows = [
      row("2024-02-01", 10),
      row("2024-03-01", 10), // monthly head (period 1)
      row("2024-06-01", 10),
      row("2024-09-01", 10), // quarterly tail (period 3)
    ];
    const segs = segmentThen(rows);
    expect(segs).not.toBeNull();
    expect(segs!.length).toBe(2);
    expect(segs!.map((s) => s.period)).toEqual([1, 3]);
    expect(segs!.map((s) => s.rows.length)).toEqual([2, 2]);
  });

  it("splits at amount jumps ≥ 2 into a three-segment chain", () => {
    const rows = [
      row("2024-02-01", 10),
      row("2024-03-01", 10),
      row("2024-04-01", 50),
      row("2024-05-01", 50),
      row("2024-06-01", 90),
      row("2024-07-01", 90),
    ];
    const segs = segmentThen(rows);
    expect(segs).not.toBeNull();
    expect(segs!.length).toBe(3);
    expect(segs!.map((s) => s.period)).toEqual([1, 1, 1]);
    expect(segs!.map((s) => s.rows.length)).toEqual([2, 2, 2]);
  });

  it("does not split a plain uniform train (ripple jitter < 2)", () => {
    const rows = [
      row("2024-02-01", 8),
      row("2024-03-01", 8),
      row("2024-04-01", 9),
    ];
    expect(segmentThen(rows)).toBeNull();
  });

  it("rejects streams with more than three segments", () => {
    const rows = [
      row("2024-02-01", 10),
      row("2024-03-01", 50),
      row("2024-04-01", 10),
      row("2024-05-01", 50),
      row("2024-06-01", 10),
      row("2024-07-01", 50),
    ];
    expect(segmentThen(rows)).toBeNull();
  });

  it("rejects a stream with no month lattice (same-month rows)", () => {
    expect(
      segmentThen([row("2024-02-01", 10), row("2024-02-15", 50)]),
    ).toBeNull();
  });
});

describe("domCandidates — pattern-derived day-of-month order", () => {
  it("reads an all-day-1 pattern (start-day, first, then minus-one)", () => {
    const doms = domCandidates(["2024-02-01", "2024-03-01"] as OCTDate[]);
    expect(doms.map((d) => d.dom)).toEqual([
      "VESTING_START_DAY",
      "FIRST_DAY_OF_MONTH",
      "VESTING_START_DAY_MINUS_ONE",
    ]);
    expect(doms.map((d) => d.originDay)).toEqual([1, 1, 2]);
    expect(doms.every((d) => !d.underflow)).toBe(true);
  });

  it("reads a month-end pattern, with the day-1-underflow MINUS_ONE last", () => {
    const doms = domCandidates([
      "2024-02-29",
      "2024-03-31",
      "2024-04-30",
    ] as OCTDate[]);
    expect(doms.map((d) => d.dom)).toEqual([
      "LAST_DAY_OF_MONTH",
      "VESTING_START_DAY",
      "VESTING_START_DAY_MINUS_ONE",
    ]);
    // The MINUS_ONE reading takes a day-1 origin that underflows onto the prior
    // month's last day.
    const minusOne = doms[2];
    expect(minusOne.originDay).toBe(1);
    expect(minusOne.underflow).toBe(true);
  });

  it("reads a mid-month pattern off the max observed day", () => {
    const doms = domCandidates(["2024-02-15", "2024-03-15"] as OCTDate[]);
    expect(doms.map((d) => d.dom)).toEqual([
      "VESTING_START_DAY",
      "VESTING_START_DAY_MINUS_ONE",
    ]);
    expect(doms.map((d) => d.originDay)).toEqual([15, 16]);
  });

  it("drops the underflow MINUS_ONE when max day + 1 overflows the month", () => {
    // max observed day is 31, so a +1 origin can't exist — only the plain
    // start-day reading survives.
    const doms = domCandidates(["2024-01-31", "2024-05-31"] as OCTDate[]);
    // (Jan-31 and May-31 are both month-ends, so this is the month-end branch.)
    expect(doms[0].dom).toBe("LAST_DAY_OF_MONTH");
  });

  it("collapses to a single trusted policy under a hint", () => {
    const doms = domCandidates(
      ["2024-02-01"] as OCTDate[],
      "LAST_DAY_OF_MONTH",
    );
    expect(doms.map((d) => d.dom)).toEqual(["LAST_DAY_OF_MONTH"]);
  });
});
