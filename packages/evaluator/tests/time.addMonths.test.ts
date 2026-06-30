import { describe, it, expect } from "vitest";
import { addMonthsRule } from "../src/interpret/time.js";
import { ResolutionContext, OCTDate, VestingDayOfMonth } from "@vestlang/types";

const ctx = (v: VestingDayOfMonth): ResolutionContext => ({
  grantDate: "2025-01-01",
  events: {},
  vesting_day_of_month: v,
  grantQuantity: 100,
  mode: "resolution",
});

const applyTest = (x: {
  src: OCTDate;
  months: number;
  rule: VestingDayOfMonth;
  expected: OCTDate;
}) => {
  const got = addMonthsRule(x.src, x.months, ctx(x.rule));
  expect(got).toBe(x.expected);
};

describe("LAST_DAY_OF_MONTH — 31 / overflow scenarios", () => {
  it("Jan 31 +1 -> Feb last day (leap year)", () => {
    applyTest({
      src: "2024-01-31",
      months: 1,
      rule: "LAST_DAY_OF_MONTH",
      expected: "2024-02-29",
    });
  });

  it("Non-leap year", () => {
    applyTest({
      src: "2023-01-31",
      months: 1,
      rule: "LAST_DAY_OF_MONTH",
      expected: "2023-02-28",
    });
  });

  it("Leap-day +12 months → non-leap Feb clamps", () => {
    applyTest({
      src: "2024-02-29",
      months: 12,
      rule: "LAST_DAY_OF_MONTH",
      expected: "2025-02-28",
    });
  });
});

describe("VESTING_START_DAY — anniversary, clamped to month end", () => {
  it("Keep original day (31) but clamp to April 30", () => {
    applyTest({
      src: "2024-03-31",
      months: 1,
      rule: "VESTING_START_DAY",
      expected: "2024-04-30",
    });
  });

  it("Original day 30 → Feb clamps to 29 (leap)", () => {
    applyTest({
      src: "2024-01-30",
      months: 1,
      rule: "VESTING_START_DAY",
      expected: "2024-02-29",
    });
  });

  it("Original day 30 → Feb clamps to 28 (non-leap)", () => {
    applyTest({
      src: "2023-01-30",
      months: 1,
      rule: "VESTING_START_DAY",
      expected: "2023-02-28",
    });
  });
});

describe("VESTING_START_DAY_MINUS_ONE — clamp the anniversary, then back a day", () => {
  it("leap Feb: clamp 31→29, −1 = 28", () => {
    applyTest({
      src: "2024-01-31",
      months: 1,
      rule: "VESTING_START_DAY_MINUS_ONE",
      expected: "2024-02-28",
    });
  });

  it("non-leap Feb: clamp 31→28, −1 = 27", () => {
    applyTest({
      src: "2023-01-31",
      months: 1,
      rule: "VESTING_START_DAY_MINUS_ONE",
      expected: "2023-02-27",
    });
  });

  it("Apr: clamp 31→30, −1 = 29", () => {
    applyTest({
      src: "2024-01-31",
      months: 3,
      rule: "VESTING_START_DAY_MINUS_ONE",
      expected: "2024-04-29",
    });
  });
});

describe("Multiple months forward", () => {
  it("Skip Feb by +2 and land on Mar 31", () => {
    applyTest({
      src: "2024-01-31",
      months: 2,
      rule: "LAST_DAY_OF_MONTH",
      expected: "2024-03-31",
    });
  });

  it("+13 months to non-leap Feb clamps to 28", () => {
    applyTest({
      src: "2024-01-31",
      months: 13,
      rule: "LAST_DAY_OF_MONTH",
      expected: "2025-02-28",
    });
  });
});
