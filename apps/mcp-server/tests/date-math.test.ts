import { describe, it, expect } from "vitest";
import { addPeriod, dateDiff, resolveVestingDay } from "../src/date-math.js";

describe("addPeriod", () => {
  it("adds months with day clamping (leap year)", () => {
    const r = addPeriod("2024-01-31", 1, "months", "31_OR_LAST_DAY_OF_MONTH");
    expect(r).toBe("2024-02-29");
  });

  it("adds months with day clamping (non-leap year)", () => {
    const r = addPeriod("2023-01-31", 1, "months", "31_OR_LAST_DAY_OF_MONTH");
    expect(r).toBe("2023-02-28");
  });

  it("adds years", () => {
    const r = addPeriod(
      "2025-01-15",
      4,
      "years",
      "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    );
    expect(r).toBe("2029-01-15");
  });

  it("adds weeks as 7 × days", () => {
    const r = addPeriod(
      "2025-01-01",
      2,
      "weeks",
      "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    );
    expect(r).toBe("2025-01-15");
  });

  it("subtracts via negative length", () => {
    const r = addPeriod(
      "2025-06-15",
      -3,
      "months",
      "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    );
    expect(r).toBe("2025-03-15");
  });
});

describe("addPeriod — year range", () => {
  it("keeps a sub-100 year instead of shifting it ~+1900", () => {
    expect(
      addPeriod(
        "0050-06-15",
        1,
        "months",
        "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
      ),
    ).toBe("0050-07-15");
  });

  it("throws cleanly instead of emitting a malformed date past 9999", () => {
    expect(() =>
      addPeriod(
        "9999-12-31",
        1,
        "years",
        "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
      ),
    ).toThrow(/range/);
  });

  // A day/week count big enough to overflow Date's internal range used to slip
  // past the year guard and surface as "0NaN-NaN-NaN". The days and weeks paths
  // must reject just as cleanly as years does.
  it("throws cleanly on a day count that overflows, not a NaN date", () => {
    const rule = "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH" as const;
    expect(() => addPeriod("2025-01-01", 300_000_000, "days", rule)).toThrow(
      /range/,
    );
    expect(() =>
      addPeriod("2025-01-01", Number.MAX_SAFE_INTEGER, "days", rule),
    ).toThrow(/range/);
    expect(() => addPeriod("2025-01-01", 50_000_000, "weeks", rule)).toThrow(
      /range/,
    );
  });
});

// The whole-month arithmetic and its parity property are tested in core, where
// monthsBetween lives (packages/core/tests/dates.test.ts). These cases only guard
// the thin wrapper: the days/months dispatch and the snake_case reshaping.
describe("dateDiff — dispatch and response shaping", () => {
  it("days case returns just { diff }, with no remainder_days key", () => {
    expect(dateDiff("2025-01-01", "2025-01-15", "days")).toEqual({ diff: 14 });
  });

  it("days case is signed — negative when to < from", () => {
    expect(dateDiff("2025-01-31", "2025-01-01", "days")).toEqual({ diff: -30 });
  });

  it("reshapes core's remainderDays into snake_case remainder_days", () => {
    // Forward whole, forward partial, backward partial — each delegated to core
    // and surfaced as { diff, remainder_days }.
    expect(dateDiff("2025-01-31", "2025-02-28", "months")).toEqual({
      diff: 1,
      remainder_days: 0,
    });
    expect(dateDiff("2025-01-15", "2025-04-20", "months")).toEqual({
      diff: 3,
      remainder_days: 5,
    });
    expect(dateDiff("2025-01-15", "2024-12-10", "months")).toEqual({
      diff: -1,
      remainder_days: -5,
    });
  });

  it("handles a multi-year month span", () => {
    expect(dateDiff("2024-02-29", "2025-02-28", "months")).toEqual({
      diff: 12,
      remainder_days: 0,
    });
  });
});

describe("resolveVestingDay", () => {
  it("clamps Feb under 29_OR_LAST_DAY_OF_MONTH (non-leap)", () => {
    expect(resolveVestingDay("2026-02-15", "29_OR_LAST_DAY_OF_MONTH")).toBe(
      "2026-02-28",
    );
  });

  it("clamps Feb under 31_OR_LAST_DAY_OF_MONTH (leap)", () => {
    expect(resolveVestingDay("2024-02-15", "31_OR_LAST_DAY_OF_MONTH")).toBe(
      "2024-02-29",
    );
  });

  it("returns day 15 for numeric rule '15' regardless of input day", () => {
    expect(resolveVestingDay("2025-03-07", "15")).toBe("2025-03-15");
  });

  it("preserves input day under VESTING_START_DAY rule when in range", () => {
    expect(
      resolveVestingDay("2025-03-20", "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH"),
    ).toBe("2025-03-20");
  });
});
