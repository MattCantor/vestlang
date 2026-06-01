import { describe, it, expect } from "vitest";
import { addMonthsRule, addDays, addPeriod, lt, gt, eq } from "../src/dates";

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
});

describe("comparisons on ISO dates", () => {
  it("lt / gt / eq", () => {
    expect(lt("2024-01-01", "2024-01-02")).toBe(true);
    expect(gt("2024-01-02", "2024-01-01")).toBe(true);
    expect(eq("2024-01-02", "2024-01-02")).toBe(true);
    expect(lt("2024-01-02", "2024-01-01")).toBe(false);
  });
});
