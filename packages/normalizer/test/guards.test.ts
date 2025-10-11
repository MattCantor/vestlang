import { describe, it, expect } from "vitest";
import type {
  ConstrainedAnchor,
  From,
  Duration,
  BaseConstraint,
  BareAnchor,
} from "@vestlang/dsl";

import {
  isDate,
  isEvent,
  isAnchor,
  isAfterConstrainedAnchor,
  isBeforeConstrainedAnchor,
  isConstrainedAnchor,
  isEarlierOfFrom,
  isLaterOfFrom,
  isDuration,
} from "../src/types/raw-ast-guards.js";
import { assertNever } from "../src/types/shared.js";

// helpers
const makeDate = (value: string): BareAnchor => ({ type: "DATE", value });
const makeEvent = (value: string): BareAnchor => ({ type: "EVENT", value });

describe("guards: anchors", () => {
  it("isDate / isEvent / isAnchor", () => {
    const d = makeDate("2025-01-01");
    const e = makeEvent("ipo");

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
  it("isAfterConstrainedAnchor / isBeforeConstrainedAnchor", () => {
    const after: BaseConstraint = {
      type: "AFTER",
      anchor: makeDate("2025-01-01"),
      strict: false,
    };
    const before: BaseConstraint = {
      type: "BEFORE",
      anchor: makeDate("2025-12-31"),
      strict: true,
    };

    expect(isAfterConstrainedAnchor(after)).toBe(true);
    expect(isBeforeConstrainedAnchor(after)).toBe(false);
    expect(isAfterConstrainedAnchor(before)).toBe(false);
    expect(isBeforeConstrainedAnchor(before)).toBe(true);
  });
});

describe("guards: FromTerm variants", () => {
  it("isQualifiedAnchor, isEarlierOfFrom, isLaterOfFrom", () => {
    const ca: ConstrainedAnchor = {
      type: "CONSTRAINED",
      base: makeEvent("grant"),
      constraints: [
        { type: "AFTER", anchor: makeDate("2025-01-01"), strict: false },
      ],
    };

    const earlier: From = {
      type: "EARLIER_OF",
      items: [makeEvent("ipo"), makeEvent("cic")],
    };
    const later: From = {
      type: "LATER_OF",
      items: [makeEvent("board"), makeEvent("cic")],
    };
    const bare: From = makeDate("2025-06-01");

    expect(isConstrainedAnchor(ca)).toBe(true);
    expect(isEarlierOfFrom(ca)).toBe(false);
    expect(isLaterOfFrom(ca)).toBe(false);

    expect(isConstrainedAnchor(earlier)).toBe(false);
    expect(isEarlierOfFrom(earlier)).toBe(true);
    expect(isLaterOfFrom(earlier)).toBe(false);

    expect(isConstrainedAnchor(later)).toBe(false);
    expect(isEarlierOfFrom(later)).toBe(false);
    expect(isLaterOfFrom(later)).toBe(true);

    expect(isConstrainedAnchor(bare)).toBe(false);
    expect(isEarlierOfFrom(bare)).toBe(false);
    expect(isLaterOfFrom(bare)).toBe(false);
    expect(isAnchor(bare)).toBe(true);
  });
});

describe("guards: durations & gates", () => {
  it("isDuration / isZeroGate", () => {
    const dur: Duration = { type: "DURATION", value: 6, unit: "MONTHS" };

    expect(isDuration(dur)).toBe(true);
  });
});

describe("guards: assertNever", () => {
  it("throws to signal unreachable code", () => {
    // At runtime we can only verify it throws.
    expect(() => assertNever(undefined as kever)).toThrowError();
  });
});
