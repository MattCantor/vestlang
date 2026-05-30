import { describe, it, expect } from "vitest";
import type { OCTDate, VestingNodeExpr } from "@vestlang/types";
import { lowerCliff } from "../src/resolve/cliff";
import { baseCtx, makeSingletonNode, makeVestingBaseDate, makeVestingBaseEvent, makeDuration } from "./helpers";

const ctx = baseCtx({
  events: { grantDate: "2025-01-01" as OCTDate, ipo: "2026-04-01" as OCTDate },
  vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
});
const anchor = "2025-01-01" as OCTDate;

describe("lowerCliff", () => {
  it("no cliff → NONE", () => {
    expect(lowerCliff(undefined, anchor, "MONTHS", 1, 48, ctx)).toEqual({
      state: "NONE",
    });
  });

  it("on-grid +12 month cliff → {length:12, period_type:MONTHS, percentage:1/4}", () => {
    const cliff: VestingNodeExpr = makeSingletonNode(
      makeVestingBaseEvent("vestingStart"),
      [makeDuration(12, "MONTHS", "PLUS")],
    );
    expect(lowerCliff(cliff, anchor, "MONTHS", 1, 48, ctx)).toEqual({
      state: "RESOLVED",
      cliff: {
        length: 12,
        period_type: "MONTHS",
        percentage: { numerator: 1, denominator: 4 },
      },
    });
  });

  it("off-grid date cliff → falls back to DAYS, proportional pre-cliff share", () => {
    // 2025-03-17 on a monthly-4 grid: Feb 1 + Mar 1 are pre-cliff (m=2 of 4).
    const cliff: VestingNodeExpr = makeSingletonNode(
      makeVestingBaseDate("2025-03-17" as OCTDate),
    );
    expect(lowerCliff(cliff, anchor, "MONTHS", 1, 4, ctx)).toEqual({
      state: "RESOLVED",
      cliff: {
        length: 75, // 2025-01-01 + 75 days = 2025-03-17
        period_type: "DAYS",
        percentage: { numerator: 1, denominator: 2 },
      },
    });
  });

  it("event-anchored cliff → EVENT (no time-based representation)", () => {
    const cliff: VestingNodeExpr = makeSingletonNode(makeVestingBaseEvent("ipo"));
    expect(lowerCliff(cliff, anchor, "MONTHS", 1, 48, ctx)).toEqual({
      state: "EVENT",
      eventId: "ipo",
    });
  });

  it("cliff at/before the start → NONE", () => {
    const cliff: VestingNodeExpr = makeSingletonNode(
      makeVestingBaseDate("2024-06-01" as OCTDate),
    );
    expect(lowerCliff(cliff, anchor, "MONTHS", 1, 48, ctx)).toEqual({
      state: "NONE",
    });
  });

  it("unresolved cliff (unfired event via combinator) → UNRESOLVED with blockers", () => {
    // LATER_OF over two unfired events → no resolvable date.
    const cliff: VestingNodeExpr = {
      type: "LATER_OF",
      items: [
        makeSingletonNode(makeVestingBaseEvent("a")),
        makeSingletonNode(makeVestingBaseEvent("b")),
      ],
    };
    const result = lowerCliff(cliff, anchor, "MONTHS", 1, 48, ctx);
    expect(result.state).toBe("UNRESOLVED");
  });
});
