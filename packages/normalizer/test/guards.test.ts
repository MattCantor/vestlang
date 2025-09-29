import { describe, it, expect } from "vitest";
import type {
  Anchor,
  TemporalPredNode,
  QualifiedAnchor,
  FromTerm,
  Expr,
  Schedule,
  Duration,
  ZeroGate,
} from "@vestlang/dsl";

import {
  isDate,
  isEvent,
  isAnchor,
  isAfterPred,
  isBeforePred,
  isBetweenPred,
  isQualifiedAnchor,
  isEarlierOfFrom,
  isLaterOfFrom,
  isDuration,
  isZeroGate,
  isSchedule,
  isEarlierOfSchedules,
  isLaterOfSchedules,
  assertNever,
} from "../src/guards";

// helpers
const date = (iso: string): Anchor => ({ type: "Date", iso });
const event = (name: string): Anchor => ({ type: "Event", name });

describe("guards: anchors", () => {
  it("isDate / isEvent / isAnchor", () => {
    const d = date("2025-01-01");
    const e = event("ipo");

    expect(isDate(d)).toBe(true);
    expect(isEvent(d)).toBe(false);
    expect(isAnchor(d)).toBe(true);

    expect(isDate(e)).toBe(false);
    expect(isEvent(e)).toBe(true);
    expect(isAnchor(e)).toBe(true);

    expect(isAnchor(null)).toBe(false);
    expect(isAnchor({})).toBe(false);
  });
});

describe("guards: temporal predicate nodes", () => {
  it("isAfterPred / isBeforePred / isBetweenPred", () => {
    const after: TemporalPredNode = {
      type: "After",
      i: date("2025-01-01"),
      strict: false,
    };
    const before: TemporalPredNode = {
      type: "Before",
      i: date("2025-12-31"),
      strict: true,
    };
    const between: TemporalPredNode = {
      type: "Between",
      a: date("2025-01-01"),
      b: date("2025-12-31"),
      strict: false,
    };

    expect(isAfterPred(after)).toBe(true);
    expect(isBeforePred(after)).toBe(false);
    expect(isBetweenPred(after)).toBe(false);

    expect(isAfterPred(before)).toBe(false);
    expect(isBeforePred(before)).toBe(true);
    expect(isBetweenPred(before)).toBe(false);

    expect(isAfterPred(between)).toBe(false);
    expect(isBeforePred(between)).toBe(false);
    expect(isBetweenPred(between)).toBe(true);
  });
});

describe("guards: FromTerm variants", () => {
  it("isQualifiedAnchor, isEarlierOfFrom, isLaterOfFrom", () => {
    const qa: QualifiedAnchor = {
      type: "Qualified",
      base: event("grant"),
      predicates: [{ type: "After", i: date("2025-01-01"), strict: false }],
    };

    const earlier: FromTerm = {
      type: "EarlierOf",
      items: [event("ipo"), event("cic")],
    };
    const later: FromTerm = {
      type: "LaterOf",
      items: [event("board"), event("cic")],
    };
    const bare: FromTerm = date("2025-06-01");

    expect(isQualifiedAnchor(qa)).toBe(true);
    expect(isEarlierOfFrom(qa)).toBe(false);
    expect(isLaterOfFrom(qa)).toBe(false);

    expect(isQualifiedAnchor(earlier)).toBe(false);
    expect(isEarlierOfFrom(earlier)).toBe(true);
    expect(isLaterOfFrom(earlier)).toBe(false);

    expect(isQualifiedAnchor(later)).toBe(false);
    expect(isEarlierOfFrom(later)).toBe(false);
    expect(isLaterOfFrom(later)).toBe(true);

    expect(isQualifiedAnchor(bare)).toBe(false);
    expect(isEarlierOfFrom(bare)).toBe(false);
    expect(isLaterOfFrom(bare)).toBe(false);
    expect(isAnchor(bare)).toBe(true);
  });
});

describe("guards: durations & gates", () => {
  it("isDuration / isZeroGate", () => {
    const dur: Duration = { type: "Duration", value: 6, unit: "months" };
    const zero: ZeroGate = { type: "Zero" };

    expect(isDuration(dur)).toBe(true);
    expect(isZeroGate(dur)).toBe(false);

    expect(isDuration(zero)).toBe(false);
    expect(isZeroGate(zero)).toBe(true);
  });
});

describe("guards: Expr / Schedule variants", () => {
  it("isSchedule, isEarlierOfSchedules, isLaterOfSchedules", () => {
    const sched: Schedule = {
      type: "Schedule",
      from: null,
      over: { type: "Duration", value: 0, unit: "days" },
      every: { type: "Duration", value: 0, unit: "days" },
      cliff: { type: "Zero" },
    };

    const earlier: Expr = {
      type: "EarlierOfSchedules",
      items: [sched] as Expr[],
    };
    const later: Expr = { type: "LaterOfSchedules", items: [sched] as Expr[] };

    expect(isSchedule(sched)).toBe(true);
    expect(isEarlierOfSchedules(sched)).toBe(false);
    expect(isLaterOfSchedules(sched)).toBe(false);

    expect(isSchedule(earlier)).toBe(false);
    expect(isEarlierOfSchedules(earlier)).toBe(true);
    expect(isLaterOfSchedules(earlier)).toBe(false);

    expect(isSchedule(later)).toBe(false);
    expect(isEarlierOfSchedules(later)).toBe(false);
    expect(isLaterOfSchedules(later)).toBe(true);
  });
});

describe("guards: assertNever", () => {
  it("throws to signal unreachable code", () => {
    // At runtime we can only verify it throws.
    expect(() => assertNever(undefined as never, "unreachable")).toThrowError();
  });
});
