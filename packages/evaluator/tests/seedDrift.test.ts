import { describe, expect, it } from "vitest";
import type {
  OCTDate,
  ResolvedInstallment,
  Statement,
} from "@vestlang/types";
import { evaluateStatement } from "../src/evaluate/build.js";
import {
  baseCtx,
  makeSingletonSchedule,
  makeSingletonNode,
  makeVestingBaseDate,
} from "./helpers.js";

/**
 * Regression tests for the drift bug in tranche-date generation.
 *
 * Pre-fix: build.ts iterated `d = nextDate(d, ...)` and `addMonthsRule`
 * used `d.getUTCDate()` as the seed day. Any short month (e.g. Feb)
 * clamping to an earlier day caused that lower day to become the new
 * seed for every subsequent iteration.
 *
 * Post-fix: each tranche is computed from the original `vesting_start`
 * via `nextDate(start, type, length * i, ctx)`, so the seed day is
 * preserved through the schedule — only clamped for months that are
 * actually shorter than the seed.
 */

function resolvedDates(installments: readonly unknown[]): string[] {
  return installments
    .filter(
      (i): i is ResolvedInstallment =>
        (i as ResolvedInstallment).meta?.state === "RESOLVED",
    )
    .map((i) => i.date as unknown as string);
}

function monthlyFromDay31(occurrences: number): Statement {
  return {
    amount: { type: "QUANTITY", value: occurrences * 1000 },
    expr: makeSingletonSchedule(
      makeSingletonNode(makeVestingBaseDate("2024-01-31" as OCTDate)),
      { type: "MONTHS", length: 1, occurrences },
    ),
  };
}

describe("addMonthsRule seed drift — regression", () => {
  it("VESTING_START_DAY_OR_LAST: day-31 seed does not drift to day-29 after Feb", () => {
    const stmt = monthlyFromDay31(14);
    const ctx = baseCtx({
      events: { grantDate: "2024-01-31" as OCTDate },
      grantQuantity: 14000,
      asOf: "2025-12-31" as OCTDate,
      vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
      allocation_type: "CUMULATIVE_ROUNDING",
    });
    const dates = resolvedDates(evaluateStatement(stmt, ctx).installments);

    // First tranche clamps Jan 31 → Feb 29 (2024 leap year).
    expect(dates[0]).toBe("2024-02-29");
    // Pre-fix, every subsequent date inherited day 29.
    // Post-fix, seed day 31 is preserved: each month uses day 31 when
    // available, last-day-of-month when not.
    expect(dates[1]).toBe("2024-03-31");
    expect(dates[2]).toBe("2024-04-30");
    expect(dates[3]).toBe("2024-05-31");
    expect(dates[4]).toBe("2024-06-30");
    expect(dates[5]).toBe("2024-07-31");
    expect(dates[10]).toBe("2024-12-31");
    // Feb 2025 is non-leap → clamps to 28. Pre-fix, this ALSO infected
    // all future dates with day 28. Post-fix, the next month returns to
    // day 31.
    expect(dates[12]).toBe("2025-02-28");
    expect(dates[13]).toBe("2025-03-31");
  });

  it("VESTING_START_DAY_OR_LAST: long run preserves day-31 across multiple Februaries", () => {
    const stmt = monthlyFromDay31(48);
    const ctx = baseCtx({
      events: { grantDate: "2024-01-31" as OCTDate },
      grantQuantity: 48000,
      asOf: "2028-02-01" as OCTDate,
      vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
      allocation_type: "CUMULATIVE_ROUNDING",
    });
    const dates = resolvedDates(evaluateStatement(stmt, ctx).installments);

    expect(dates).toHaveLength(48);

    // Count dates by day-of-month. Pre-fix, after the Feb-2024 clamp,
    // every one of the 47 remaining dates would have been on day 29 or
    // later day 28. Post-fix, the seed (31) is preserved and each month
    // independently clamps to its own last day.
    //
    // Tranche months: Feb 2024 through Jan 2028 (48 months).
    //   31-day months (Jan/Mar/May/Jul/Aug/Oct/Dec) across the window:
    //     6 in 2024 + 7 × 3 (2025-2027) + 1 in 2028 = 28
    //   30-day months (Apr/Jun/Sep/Nov): 4 × 4 years = 16
    //   Feb (leap, 2024 only in window): 1 on day 29
    //   Feb (non-leap, 2025/2026/2027): 3 on day 28
    const byDay = new Map<string, number>();
    for (const date of dates) {
      const day = date.slice(-2);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    expect(byDay.get("31")).toBe(28);
    expect(byDay.get("30")).toBe(16);
    expect(byDay.get("29")).toBe(1);
    expect(byDay.get("28")).toBe(3);
  });

  it("31_OR_LAST_DAY_OF_MONTH: fixed-day-31 policy behaves identically to VESTING_START_DAY when seed is 31", () => {
    const stmt = monthlyFromDay31(14);
    const ctx = baseCtx({
      events: { grantDate: "2024-01-31" as OCTDate },
      grantQuantity: 14000,
      asOf: "2025-12-31" as OCTDate,
      vesting_day_of_month: "31_OR_LAST_DAY_OF_MONTH",
      allocation_type: "CUMULATIVE_ROUNDING",
    });
    const dates = resolvedDates(evaluateStatement(stmt, ctx).installments);

    expect(dates[0]).toBe("2024-02-29");
    expect(dates[1]).toBe("2024-03-31");
    expect(dates[12]).toBe("2025-02-28");
    expect(dates[13]).toBe("2025-03-31");
  });

  it("numeric-day policies are independent of the seed date's day-of-month", () => {
    // Under policy "15", every tranche lands on day 15 regardless of
    // what day the vesting_start uses. Pre-fix, this was already correct
    // for numeric policies (they ignore d.getUTCDate()), but this test
    // pins the invariant so a future refactor can't regress it.
    const stmt: Statement = {
      amount: { type: "QUANTITY", value: 6000 },
      expr: makeSingletonSchedule(
        makeSingletonNode(makeVestingBaseDate("2024-01-31" as OCTDate)),
        { type: "MONTHS", length: 1, occurrences: 6 },
      ),
    };
    const ctx = baseCtx({
      events: { grantDate: "2024-01-31" as OCTDate },
      grantQuantity: 6000,
      asOf: "2024-12-31" as OCTDate,
      vesting_day_of_month: "15",
      allocation_type: "CUMULATIVE_ROUNDING",
    });
    const dates = resolvedDates(evaluateStatement(stmt, ctx).installments);

    expect(dates).toEqual([
      "2024-02-15",
      "2024-03-15",
      "2024-04-15",
      "2024-05-15",
      "2024-06-15",
      "2024-07-15",
    ]);
  });
});
