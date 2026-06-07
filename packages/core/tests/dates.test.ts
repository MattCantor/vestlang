import { describe, it, expect } from "vitest";
import {
  addMonthsRule,
  addDays,
  addPeriod,
  advanceCursor,
  lt,
  gt,
  eq,
} from "../src/dates";

// Day-of-month + overflow cases mirror evaluator/tests/time.addMonths.test.ts,
// adapted to the direct VestingDayOfMonth parameter.
describe("addMonthsRule — 31 / overflow scenarios", () => {
  it("Jan 31 +1mo -> Feb last day (leap year)", () => {
    expect(addMonthsRule("2024-01-31", 1, "31_OR_LAST_DAY_OF_MONTH")).toBe(
      "2024-02-29",
    );
  });

  it("Non-leap year", () => {
    expect(addMonthsRule("2023-01-31", 1, "31_OR_LAST_DAY_OF_MONTH")).toBe(
      "2023-02-28",
    );
  });

  it("30 or last -> 29 (leap Feb)", () => {
    expect(addMonthsRule("2024-01-31", 1, "30_OR_LAST_DAY_OF_MONTH")).toBe(
      "2024-02-29",
    );
  });

  it("29 or last -> 29", () => {
    expect(addMonthsRule("2024-01-31", 1, "29_OR_LAST_DAY_OF_MONTH")).toBe(
      "2024-02-29",
    );
  });
});

describe("addMonthsRule — VESTING_START_DAY_OR_LAST_DAY_OF_MONTH", () => {
  it("keep original day (31) but clamp to April 30", () => {
    expect(
      addMonthsRule("2024-03-31", 1, "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH"),
    ).toBe("2024-04-30");
  });

  it("original day 30 -> Feb clamps to 29 (leap)", () => {
    expect(
      addMonthsRule("2024-01-30", 1, "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH"),
    ).toBe("2024-02-29");
  });

  it("original day 30 -> Feb clamps to 28 (non-leap)", () => {
    expect(
      addMonthsRule("2023-01-30", 1, "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH"),
    ).toBe("2023-02-28");
  });

  it("defaults to VESTING_START_DAY policy when omitted", () => {
    expect(addMonthsRule("2024-03-31", 1)).toBe("2024-04-30");
  });
});

describe("addMonthsRule — origin carries the day-of-month across a clamp", () => {
  // When a chain hands off on a short month the cursor gets clamped (Jan 31 + 1mo
  // is Feb 28). Stepping further from that Feb 28 would normally stick on the 28th.
  // Passing the chain's first date (Jan 31) as the origin tells the stepper which
  // day to aim for, so the schedule springs back to the 31st where it fits.
  it("steps from Feb 28 but lands on Mar 31 when origin is Jan 31", () => {
    expect(
      addMonthsRule(
        "2025-02-28",
        1,
        "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
        "2025-01-31",
      ),
    ).toBe("2025-03-31");
  });

  it("clamps the origin day to April's last day (30)", () => {
    expect(
      addMonthsRule(
        "2025-02-28",
        2,
        "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
        "2025-01-31",
      ),
    ).toBe("2025-04-30");
  });

  it("without an origin, the day comes from the date being stepped from", () => {
    // No origin argument: Feb 28 stays the reference, so March holds the 28th.
    expect(
      addMonthsRule("2025-02-28", 1, "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH"),
    ).toBe("2025-03-28");
  });
});

describe("addMonthsRule — fixed numeric day + multi-month", () => {
  it("explicit day 15", () => {
    expect(addMonthsRule("2024-01-31", 1, "15")).toBe("2024-02-15");
  });

  it("leap-day +12mo -> non-leap Feb clamps", () => {
    expect(addMonthsRule("2024-02-29", 12, "31_OR_LAST_DAY_OF_MONTH")).toBe(
      "2025-02-28",
    );
  });

  it("skip Feb by +2 and land on Mar 31", () => {
    expect(addMonthsRule("2024-01-31", 2, "31_OR_LAST_DAY_OF_MONTH")).toBe(
      "2024-03-31",
    );
  });

  it("+13 months to non-leap Feb clamps to 28", () => {
    expect(addMonthsRule("2024-01-31", 13, "31_OR_LAST_DAY_OF_MONTH")).toBe(
      "2025-02-28",
    );
  });
});

describe("addDays — UTC-pure across DST boundaries", () => {
  it("simple step", () => {
    expect(addDays("2024-01-10", 5)).toBe("2024-01-15");
  });

  it("spans the spring-forward transition", () => {
    expect(addDays("2024-02-26", 14)).toBe("2024-03-11");
  });

  it("spans the fall-back transition", () => {
    expect(addDays("2024-10-27", 14)).toBe("2024-11-10");
  });

  it("large step over leap day and DST", () => {
    expect(addDays("2024-01-01", 84)).toBe("2024-03-25");
  });
});

describe("addPeriod", () => {
  it("DAYS", () => {
    expect(addPeriod("2024-01-01", 10, "DAYS")).toBe("2024-01-11");
  });

  it("MONTHS honors the day-of-month policy", () => {
    expect(
      addPeriod("2024-01-31", 1, "MONTHS", "31_OR_LAST_DAY_OF_MONTH"),
    ).toBe("2024-02-29");
  });

  it("YEARS = months × 12 (with day-of-month clamping)", () => {
    expect(addPeriod("2024-02-29", 1, "YEARS")).toBe("2025-02-28");
    expect(addPeriod("2024-01-15", 2, "YEARS")).toBe("2026-01-15");
  });

  it("forwards the origin to the month stepper", () => {
    expect(
      addPeriod(
        "2025-02-28",
        1,
        "MONTHS",
        "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
        "2025-01-31",
      ),
    ).toBe("2025-03-31");
  });
});

describe("advanceCursor — origin forwarding", () => {
  // advanceCursor steps a whole segment (occurrences × period) and hands the
  // origin straight through. A 1-occurrence monthly segment from Feb 28 with the
  // chain origin on Jan 31 ends on Mar 31, not Mar 28.
  it("carries the chain origin through a segment hop", () => {
    expect(
      advanceCursor(
        "2025-02-28",
        1,
        1,
        "MONTHS",
        "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
        "2025-01-31",
      ),
    ).toBe("2025-03-31");
  });

  it("defaults the origin to the anchor when omitted", () => {
    expect(advanceCursor("2025-02-28", 1, 1, "MONTHS")).toBe("2025-03-28");
  });
});

describe("year range — sub-100 preserved, out-of-range rejected", () => {
  // The month path used to rebuild dates via Date.UTC(year, …), which remaps
  // years 0–99 to 1900–1999. Component-based building keeps the year verbatim.
  it("sub-100 year is not shifted by ~+1900 in the month path", () => {
    expect(addMonthsRule("0050-06-15", 1)).toBe("0050-07-15");
    expect(addPeriod("0050-01-15", 1, "MONTHS")).toBe("0050-02-15");
  });

  it("sub-100 year survives the day path too", () => {
    expect(addDays("0050-06-15", 1)).toBe("0050-06-16");
  });

  it("rejects arithmetic that overflows past year 9999", () => {
    expect(() => addPeriod("9999-12-31", 1, "YEARS")).toThrow(/range/);
    expect(() => addMonthsRule("9999-12-15", 1)).toThrow(/range/);
  });

  it("rejects arithmetic that underflows before year 0001", () => {
    expect(() => addPeriod("0001-01-01", 1, "YEARS")).not.toThrow(); // 0002 is fine
    expect(() => addMonthsRule("0001-01-15", -12)).toThrow(/range/);
  });
});

describe("comparisons on ISO dates", () => {
  it("lt / gt / eq", () => {
    expect(lt("2024-01-01", "2024-01-02")).toBe(true);
    expect(gt("2024-01-02", "2024-01-01")).toBe(true);
    expect(eq("2024-01-02", "2024-01-02")).toBe(true);
    expect(lt("2024-01-02", "2024-01-01")).toBe(false);
  });
});
