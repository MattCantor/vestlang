import { describe, it, expect } from "vitest";
import type { OCTDate, VestingNodeExpr } from "@vestlang/types";
import { lowerCliff, lowerDeferredCliff } from "../src/resolve/cliff";
import {
  baseCtx,
  makeGatedNode,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
  makeDuration,
  makeVestingBaseGrantDate,
  makeVestingBaseVestingStart,
} from "./helpers";

const ctx = baseCtx({
  grantDate: "2025-01-01",
  events: { ipo: "2026-04-01" },
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
      makeVestingBaseVestingStart(),
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
      makeVestingBaseDate("2025-03-17"),
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
    const cliff: VestingNodeExpr = makeSingletonNode(
      makeVestingBaseEvent("ipo"),
    );
    expect(lowerCliff(cliff, anchor, "MONTHS", 1, 48, ctx)).toEqual({
      state: "EVENT",
      eventId: "ipo",
    });
  });

  it("cliff at/before the start → NONE", () => {
    const cliff: VestingNodeExpr = makeSingletonNode(
      makeVestingBaseDate("2024-06-01"),
    );
    expect(lowerCliff(cliff, anchor, "MONTHS", 1, 48, ctx)).toEqual({
      state: "NONE",
    });
  });

  it("unresolved cliff (unfired event via combinator) → UNRESOLVED with blockers", () => {
    // LATER_OF over two unfired events → no resolvable date.
    const cliff: VestingNodeExpr = {
      type: "NODE_LATER_OF",
      items: [
        makeSingletonNode(makeVestingBaseEvent("a")),
        makeSingletonNode(makeVestingBaseEvent("b")),
      ],
    };
    const result = lowerCliff(cliff, anchor, "MONTHS", 1, 48, ctx);
    expect(result.state).toBe("UNRESOLVED");
  });

  it("partial LATER_OF cliff (one branch unfired) → UNRESOLVED, not the resolved floor", () => {
    // LATER OF(+12 months, EVENT ipo) with ipo unfired: the +12mo branch is only a
    // lower bound — the pending event can only push the cliff later — so the cliff
    // must stay UNRESOLVED rather than collapse to the floor (which would over-vest).
    const noIpo = baseCtx({ grantDate: "2025-01-01", events: {} });
    const cliff: VestingNodeExpr = {
      type: "NODE_LATER_OF",
      items: [
        makeSingletonNode(makeVestingBaseVestingStart(), [
          makeDuration(12, "MONTHS", "PLUS"),
        ]),
        makeSingletonNode(makeVestingBaseEvent("ipo")),
      ],
    };
    const result = lowerCliff(cliff, anchor, "MONTHS", 1, 48, noIpo);
    expect(result.state).toBe("UNRESOLVED");
    if (result.state === "UNRESOLVED") {
      expect(
        result.blockers.some((b) => b.type === "EVENT_NOT_YET_OCCURRED"),
      ).toBe(true);
    }
  });
});

describe("lowerCliff — gated event cliff (#113)", () => {
  // CLIFF EVENT acquisition AFTER grantDate + 1 year: the gate decides whether
  // the event cliff stands, instead of being dropped. anchor is the grant date.
  const gatedCliff = makeGatedNode(
    makeVestingBaseEvent("acquisition"),
    "AFTER",
    makeSingletonNode(makeVestingBaseGrantDate(), [
      makeDuration(12, "MONTHS", "PLUS"),
    ]),
  );

  it("gate violated (event fired before the gate) → UNRESOLVED with IMPOSSIBLE_CONDITION", () => {
    // acquisition 2025-06-01 is not after grantDate + 12 months (2026-01-01).
    const c = baseCtx({
      grantDate: "2025-01-01",
      events: { acquisition: "2025-06-01" },
    });
    const result = lowerCliff(gatedCliff, anchor, "MONTHS", 1, 48, c);
    expect(result.state).toBe("UNRESOLVED");
    if (result.state === "UNRESOLVED") {
      expect(
        result.blockers.some((b) => b.type === "IMPOSSIBLE_CONDITION"),
      ).toBe(true);
    }
  });

  it("gate satisfied (event fired after the gate) → EVENT", () => {
    // acquisition 2026-06-01 is after grantDate + 12 months; the gate holds, so
    // the cliff is the bare event cliff again (events-only downstream).
    const c = baseCtx({
      grantDate: "2025-01-01",
      events: { acquisition: "2026-06-01" },
    });
    expect(lowerCliff(gatedCliff, anchor, "MONTHS", 1, 48, c)).toEqual({
      state: "EVENT",
      eventId: "acquisition",
    });
  });

  it("gate pending (event unfired) → UNRESOLVED with EVENT_NOT_YET_OCCURRED", () => {
    const c = baseCtx({ grantDate: "2025-01-01", events: {} });
    const result = lowerCliff(gatedCliff, anchor, "MONTHS", 1, 48, c);
    expect(result.state).toBe("UNRESOLVED");
    if (result.state === "UNRESOLVED") {
      expect(
        result.blockers.some((b) => b.type === "EVENT_NOT_YET_OCCURRED"),
      ).toBe(true);
    }
  });
});

describe("lowerDeferredCliff (no concrete anchor)", () => {
  const vsCliff = (value: number, unit: "DAYS" | "MONTHS") =>
    makeSingletonNode(makeVestingBaseVestingStart(), [
      makeDuration(value, unit, "PLUS"),
    ]);

  it("no cliff → NONE", () => {
    expect(lowerDeferredCliff(undefined, "MONTHS", 1, 48)).toEqual({
      state: "NONE",
    });
  });

  it("vestingStart + 12 months on a 1-month/48 grid → {12mo, 1/4}, anchor-free", () => {
    expect(lowerDeferredCliff(vsCliff(12, "MONTHS"), "MONTHS", 1, 48)).toEqual({
      state: "RESOLVED",
      cliff: {
        length: 12,
        period_type: "MONTHS",
        percentage: { numerator: 1, denominator: 4 },
      },
    });
  });

  it("off-grid duration cliff (7mo on a 2-month grid) → m = floor(7/2) = 3", () => {
    expect(lowerDeferredCliff(vsCliff(7, "MONTHS"), "MONTHS", 2, 24)).toEqual({
      state: "RESOLVED",
      cliff: {
        length: 7,
        period_type: "MONTHS",
        percentage: { numerator: 1, denominator: 8 }, // 3/24
      },
    });
  });

  it("day-unit cliff on a day-unit grid is anchor-free", () => {
    expect(lowerDeferredCliff(vsCliff(90, "DAYS"), "DAYS", 30, 12)).toEqual({
      state: "RESOLVED",
      cliff: {
        length: 90,
        period_type: "DAYS",
        percentage: { numerator: 1, denominator: 4 }, // 3/12
      },
    });
  });

  it("cliff shorter than the first occurrence → NONE (no pre-cliff share)", () => {
    expect(lowerDeferredCliff(vsCliff(11, "MONTHS"), "MONTHS", 12, 4)).toEqual({
      state: "NONE",
    });
  });

  it("cross-unit cliff (months over a days grid) needs the anchor → UNRESOLVED", () => {
    expect(lowerDeferredCliff(vsCliff(12, "MONTHS"), "DAYS", 30, 48)).toEqual({
      state: "UNRESOLVED",
      blockers: [],
    });
  });

  it("event-anchored cliff has no anchor-free form → UNRESOLVED", () => {
    const cliff = makeSingletonNode(makeVestingBaseEvent("ipo"));
    expect(lowerDeferredCliff(cliff, "MONTHS", 1, 48)).toEqual({
      state: "UNRESOLVED",
      blockers: [],
    });
  });

  it("combinator cliff is not a bare duration → UNRESOLVED", () => {
    const cliff: VestingNodeExpr = {
      type: "NODE_LATER_OF",
      items: [
        makeSingletonNode(makeVestingBaseVestingStart(), [
          makeDuration(12, "MONTHS", "PLUS"),
        ]),
        makeSingletonNode(makeVestingBaseEvent("ipo")),
      ],
    };
    expect(lowerDeferredCliff(cliff, "MONTHS", 1, 48)).toEqual({
      state: "UNRESOLVED",
      blockers: [],
    });
  });

  it("a cliff measured from grant date (not vestingStart) needs the anchor → UNRESOLVED", () => {
    const cliff = makeSingletonNode(makeVestingBaseGrantDate(), [
      makeDuration(12, "MONTHS", "PLUS"),
    ]);
    expect(lowerDeferredCliff(cliff, "MONTHS", 1, 48)).toEqual({
      state: "UNRESOLVED",
      blockers: [],
    });
  });
});
