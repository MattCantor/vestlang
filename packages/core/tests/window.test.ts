import { describe, it, expect } from "vitest";
import type {
  AtomCondition,
  Condition,
  ConstraintTag,
  OCTDate,
  VestingBase,
} from "@vestlang/types";
import { isEmptySatisfiableSet, satisfiableSet } from "../src/window";

// The static empty-window analysis, lifted from the linter into core so the
// evaluator can classify a jointly-empty gate impossible (#287). It reads only
// statically-datable anchors (plain fixed DATEs); anything else (an event base, an
// offset) contributes the full line, so it can only ever under-report.

const dateBase = (value: OCTDate): VestingBase => ({ type: "DATE", value });
const eventBase = (value: string): VestingBase => ({ type: "EVENT", value });

// A bare BEFORE/AFTER atom over a fixed date (or, with `base`, any anchor).
const atom = (
  type: ConstraintTag,
  date: OCTDate,
  strict = false,
  base: VestingBase = dateBase(date),
): AtomCondition => ({
  type: "ATOM",
  constraint: {
    type,
    base: { type: "NODE", base, offsets: [] },
    strict,
  },
});

const and = (...items: Condition[]): Condition =>
  ({ type: "AND", items }) as Condition;
const or = (...items: Condition[]): Condition =>
  ({ type: "OR", items }) as Condition;

describe("satisfiableSet — emptiness", () => {
  it("a single bound is a non-empty half-line", () => {
    expect(isEmptySatisfiableSet(atom("AFTER", "2025-01-01"))).toBe(false);
    expect(isEmptySatisfiableSet(atom("BEFORE", "2025-01-01"))).toBe(false);
  });

  it("AND of two bounds that don't overlap is empty (the #287 gate)", () => {
    const gate = and(atom("AFTER", "2026-01-01"), atom("BEFORE", "2025-01-01"));
    expect(satisfiableSet(gate)).toEqual([]);
    expect(isEmptySatisfiableSet(gate)).toBe(true);
  });

  it("AND of two bounds that do overlap is non-empty", () => {
    const gate = and(atom("AFTER", "2025-01-01"), atom("BEFORE", "2026-01-01"));
    expect(isEmptySatisfiableSet(gate)).toBe(false);
  });

  it("equal non-strict bounds hold a one-day window; strict eats it", () => {
    // on-or-after AND on-or-before the same day still admits that one day.
    expect(
      isEmptySatisfiableSet(
        and(atom("AFTER", "2025-06-01"), atom("BEFORE", "2025-06-01")),
      ),
    ).toBe(false);
    // strictly-after AND strictly-before the same day excludes the day itself —
    // nothing left.
    expect(
      isEmptySatisfiableSet(
        and(
          atom("AFTER", "2025-06-01", true),
          atom("BEFORE", "2025-06-01", true),
        ),
      ),
    ).toBe(true);
  });

  it("OR of two empty arms is empty; one live arm rescues it", () => {
    const deadArm = and(
      atom("AFTER", "2026-01-01"),
      atom("BEFORE", "2025-01-01"),
    );
    expect(isEmptySatisfiableSet(or(deadArm, deadArm))).toBe(true);
    expect(
      isEmptySatisfiableSet(or(deadArm, atom("AFTER", "2025-01-01"))),
    ).toBe(false);
  });
});

describe("satisfiableSet — soundness (only under-reports)", () => {
  it("a non-datable anchor contributes the full line, never an empty set", () => {
    // The cliff-anchor case: an EVENT base can't be statically dated, so even when
    // paired with date bounds the conjunction stays whatever the date bounds allow
    // — it never becomes spuriously empty.
    const eventBounded = and(
      atom("AFTER", "2025-01-01"),
      atom("BEFORE", "2026-01-01", false, eventBase("ipo")),
    );
    // The BEFORE-event atom is the full line, so the set is just the AFTER half-line.
    expect(isEmptySatisfiableSet(eventBounded)).toBe(false);

    // Two event bounds: nothing datable at all, so the full line — never empty.
    expect(
      isEmptySatisfiableSet(
        and(
          atom("AFTER", "2025-01-01", false, eventBase("a")),
          atom("BEFORE", "2025-01-01", false, eventBase("b")),
        ),
      ),
    ).toBe(false);
  });
});
