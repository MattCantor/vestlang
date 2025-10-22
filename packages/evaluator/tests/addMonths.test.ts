// test/addMonthsRule.test.ts
import { describe, it, expect } from "vitest";
import { addMonthsRule } from "../src/time.js";
import { OCTDate, vesting_day_of_month } from "@vestlang/types";
import { EvaluationContext } from "../dist/types.js";

describe("addMonthsRule", () => {
  const ctx = (v: vesting_day_of_month): EvaluationContext => ({
    events: {},
    vesting_day_of_month: v,
    grantQuantity: 100,
    asOf: "2024-01-31" as OCTDate,
  });

  const cases: Array<{
    src: OCTDate;
    months: number;
    rule: vesting_day_of_month;
    expected: OCTDate;
    note?: string;
  }> = [
    // --- 31 / overflow scenarios
    {
      src: "2024-01-31" as OCTDate,
      months: 1,
      rule: "31_OR_LAST_DAY_OF_MONTH",
      expected: "2024-02-29" as OCTDate,
      note: "Jan 31 +1 → Feb last day (leap year)",
    },
    {
      src: "2023-01-31" as OCTDate,
      months: 1,
      rule: "31_OR_LAST_DAY_OF_MONTH",
      expected: "2023-02-28" as OCTDate,
      note: "Non-leap year",
    },
    {
      src: "2024-01-31" as OCTDate,
      months: 1,
      rule: "30_OR_LAST_DAY_OF_MONTH",
      expected: "2024-02-29" as OCTDate,
      note: "30 or last → still last (29)",
    },
    {
      src: "2024-01-31" as OCTDate,
      months: 1,
      rule: "29_OR_LAST_DAY_OF_MONTH",
      expected: "2024-02-29" as OCTDate,
      note: "29 or last → 29",
    },

    // --- "vesting start day or last day"
    {
      src: "2024-03-31" as OCTDate,
      months: 1,
      rule: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
      expected: "2024-04-30" as OCTDate,
      note: "Keep original day (31) but clamp to April 30",
    },
    {
      src: "2024-01-30" as OCTDate,
      months: 1,
      rule: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
      expected: "2024-02-29" as OCTDate,
      note: "Original day 30 → Feb clamps to 29 (leap)",
    },
    {
      src: "2023-01-30" as OCTDate,
      months: 1,
      rule: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
      expected: "2023-02-28" as OCTDate,
      note: "Original day 30 → Feb clamps to 28 (non-leap)",
    },

    // --- Exact numeric day rules ("DD")
    {
      src: "2024-01-31" as OCTDate,
      months: 1,
      rule: "15",
      expected: "2024-02-15" as OCTDate,
      note: "Explicit day 15",
    },
    {
      src: "2024-01-31" as OCTDate,
      months: 1,
      rule: "31_OR_LAST_DAY_OF_MONTH",
      expected: "2024-02-29" as OCTDate,
      note: "Explicit 31 → clamp to last day of Feb",
    },
    {
      src: "2024-02-29" as OCTDate,
      months: 12,
      rule: "31_OR_LAST_DAY_OF_MONTH",
      expected: "2025-02-28" as OCTDate,
      note: "Leap-day +12 months → non-leap Feb clamps",
    },

    // --- Multiple months forward
    {
      src: "2024-01-31" as OCTDate,
      months: 2,
      rule: "31_OR_LAST_DAY_OF_MONTH",
      expected: "2024-03-31" as OCTDate,
      note: "Skip Feb by +2 and land on Mar 31",
    },
    {
      src: "2024-01-31" as OCTDate,
      months: 13,
      rule: "31_OR_LAST_DAY_OF_MONTH",
      expected: "2025-02-28" as OCTDate,
      note: "+13 months to non-leap Feb clamps to 28",
    },
  ];

  it.each(cases)(
    "$src +$months months rule=$rule → $expected ($note)",
    ({ src, months, rule, expected }) => {
      const got = addMonthsRule(src, months, ctx(rule));
      expect(got).toBe(expected);
    },
  );
});
