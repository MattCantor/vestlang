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

describe("dateDiff", () => {
  it("counts whole days", () => {
    expect(dateDiff("2025-01-01", "2025-01-31", "days")).toEqual({ diff: 30 });
  });

  it("is signed — negative when to < from", () => {
    expect(dateDiff("2025-01-31", "2025-01-01", "days")).toEqual({ diff: -30 });
  });

  it("counts whole calendar months with remainder_days", () => {
    const r = dateDiff("2025-01-15", "2025-04-20", "months");
    expect(r.diff).toBe(3);
    expect(r.remainder_days).toBe(5);
  });

  it("decrements month count when day hasn't reached the clamped from.day", () => {
    // Feb 15 is short of min(31, daysInMonth(Feb 2025)=28)=28, so the final
    // month isn't complete — still 0. (The clamp-aware rule doesn't change this
    // case: the decrement holds whenever `to` is genuinely before the clamp.)
    const r = dateDiff("2025-01-31", "2025-02-15", "months");
    expect(r.diff).toBe(0);
    expect(r.remainder_days).toBeGreaterThan(0);
  });

  it("same date is zero months, zero days", () => {
    const r = dateDiff("2025-01-15", "2025-01-15", "months");
    expect(r.diff).toBe(0);
    expect(r.remainder_days).toBe(0);
  });

  // #139: a month-end-clamped endpoint must count as a completed month. The old
  // raw-day comparison (to.day < from.day) never credited the clamp, so Jan 31 →
  // Feb 28 read 0 rem 28 even though add_period(Jan 31, 1mo) lands exactly there.
  describe("month-end clamp counts as a completed month (#139)", () => {
    it("Jan 31 → Feb 28 is 1 month, 0 remainder", () => {
      expect(dateDiff("2025-01-31", "2025-02-28", "months")).toEqual({
        diff: 1,
        remainder_days: 0,
      });
    });

    it("leap Feb 29 → next non-leap Feb 28 is 12 months", () => {
      expect(dateDiff("2024-02-29", "2025-02-28", "months").diff).toBe(12);
    });

    it("count is monotone across a clamped boundary", () => {
      // From a Jan 31 anchor, the clamped one-month landing (Feb 28) reads 1,
      // and advancing one more day into March must not drop back to 0.
      expect(dateDiff("2025-01-31", "2025-02-27", "months").diff).toBe(0);
      expect(dateDiff("2025-01-31", "2025-02-28", "months").diff).toBe(1);
      expect(dateDiff("2025-01-31", "2025-03-01", "months").diff).toBe(1);
    });

    it("inverts add_period(months) exactly: n months → n rem 0", () => {
      const rule = "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH" as const;
      const anchors = [
        "2025-01-31", // Jan-31: every monthly landing clamps in short months
        "2024-02-29", // leap-day anchor
        "2024-01-31", // Jan-31 in a leap year
        "2025-01-15", // ordinary mid-month day
      ];
      for (const anchor of anchors) {
        for (let n = 0; n <= 24; n++) {
          const forward = addPeriod(anchor, n, "months", rule);
          expect(dateDiff(anchor, forward, "months")).toEqual({
            diff: n,
            remainder_days: 0,
          });
        }
        // Reverse from n=1 (n=0 would assert -0, which toEqual treats as
        // distinct from the +0 the diff returns).
        for (let n = 1; n <= 24; n++) {
          const backward = addPeriod(anchor, -n, "months", rule);
          expect(dateDiff(anchor, backward, "months")).toEqual({
            diff: -n,
            remainder_days: 0,
          });
        }
      }
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
