import { describe, it, expect } from "vitest";
import { addMonthsRule } from "../src/evaluate/time.js";
import {
  EvaluationContext,
  OCTDate,
  vesting_day_of_month,
} from "@vestlang/types";

const ctx = (v: vesting_day_of_month): EvaluationContext => ({
  events: { grantDate: "2025-01-01" as OCTDate },
  vesting_day_of_month: v,
  grantQuantity: 100,
  asOf: "2024-01-31" as OCTDate,
  allocation_type: "CUMULATIVE_ROUND_DOWN",
});

const applyTest = (x: {
  src: OCTDate;
  months: number;
  rule: vesting_day_of_month;
  expected: OCTDate;
}) => {
  const got = addMonthsRule(x.src, x.months, ctx(x.rule));
  expect(got).toBe(x.expected);
};

describe("Handles 31 / overflow scenarios", () => {
  it("Jan 31 +1 -> Feb last day (leap year)", () => {
    applyTest({
      src: "2024-01-31" as OCTDate,
      months: 1,
      rule: "31_OR_LAST_DAY_OF_MONTH",
      expected: "2024-02-29" as OCTDate,
    });
  });

  it("Non-leap year", () => {
    applyTest({
      src: "2023-01-31" as OCTDate,
      months: 1,
      rule: "31_OR_LAST_DAY_OF_MONTH",
      expected: "2023-02-28" as OCTDate,
    });
  });

  it("30 or last -> still last (29)", () => {
    applyTest({
      src: "2024-01-31" as OCTDate,
      months: 1,
      rule: "30_OR_LAST_DAY_OF_MONTH",
      expected: "2024-02-29" as OCTDate,
    });
  });

  it("29 or last → 29", () => {
    applyTest({
      src: "2024-01-31" as OCTDate,
      months: 1,
      rule: "29_OR_LAST_DAY_OF_MONTH",
      expected: "2024-02-29" as OCTDate,
    });
  });
});

describe("Vesting start day or last day", () => {
  it("Keep original day (31) but clamp to April 30", () => {
    applyTest({
      src: "2024-03-31" as OCTDate,
      months: 1,
      rule: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
      expected: "2024-04-30" as OCTDate,
    });
  });

  it("Original day 30 → Feb clamps to 29 (leap)", () => {
    applyTest({
      src: "2024-01-30" as OCTDate,
      months: 1,
      rule: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
      expected: "2024-02-29" as OCTDate,
    });
  });

  it("Original day 30 → Feb clamps to 28 (non-leap)", () => {
    applyTest({
      src: "2023-01-30" as OCTDate,
      months: 1,
      rule: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
      expected: "2023-02-28" as OCTDate,
    });
  });
});

describe("Exact numeric day rules ('DD')", () => {
  it("Explicit day 15", () => {
    applyTest({
      src: "2024-01-31" as OCTDate,
      months: 1,
      rule: "15",
      expected: "2024-02-15" as OCTDate,
    });
  });

  it("Explicit 31 → clamp to last day of Feb", () => {
    applyTest({
      src: "2024-01-31" as OCTDate,
      months: 1,
      rule: "31_OR_LAST_DAY_OF_MONTH",
      expected: "2024-02-29" as OCTDate,
    });
  });

  it("Leap-day +12 months → non-leap Feb clamps", () => {
    applyTest({
      src: "2024-02-29" as OCTDate,
      months: 12,
      rule: "31_OR_LAST_DAY_OF_MONTH",
      expected: "2025-02-28" as OCTDate,
    });
  });
});

describe("Multiple months forward", () => {
  it("Skip Feb by +2 and land on Mar 31", () => {
    applyTest({
      src: "2024-01-31" as OCTDate,
      months: 2,
      rule: "31_OR_LAST_DAY_OF_MONTH",
      expected: "2024-03-31" as OCTDate,
    });
  });

  it("+13 months to non-leap Feb clamps to 28", () => {
    applyTest({
      src: "2024-01-31" as OCTDate,
      months: 13,
      rule: "31_OR_LAST_DAY_OF_MONTH",
      expected: "2025-02-28" as OCTDate,
    });
  });
});
