import { describe, it, expect } from "vitest";
import type {
  Anchor,
  TemporalPredNode,
  QualifiedAnchor,
  FromTerm,
  Duration,
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
  assertNever,
} from "../src/types/raw-ast-guards.js";

// helpers
const date = (value: string): Anchor => ({ type: "Date", value });
const event = (value: string): Anchor => ({ type: "Event", value });

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
    const dur: Duration = { type: "Duration", value: 6, unit: "MONTHS" };

    expect(isDuration(dur)).toBe(true);
  });
});

describe("guards: assertNever", () => {
  it("throws to signal unreachable code", () => {
    // At runtime we can only verify it throws.
    expect(() => assertNever(undefined as never, "unreachable")).toThrowError();
  });
});
