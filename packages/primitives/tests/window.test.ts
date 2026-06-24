import { describe, it, expect } from "vitest";
import type {
  AtomCondition,
  Condition,
  ConstraintTag,
  OCTDate,
  Offsets,
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

// A bare AFTER atom whose DATE anchor carries offsets and/or a nested gate — the
// shapes `staticDate` must treat as non-datable (so the analysis falls back to the
// full line rather than reading a bound off them).
const datedAtom = (
  date: OCTDate,
  offsets: Offsets,
  condition?: Condition,
): AtomCondition => ({
  type: "ATOM",
  constraint: {
    type: "AFTER",
    base: { type: "NODE", base: dateBase(date), offsets, condition },
    strict: false,
  },
});

// A both-bounded range: AFTER lo AND BEFORE hi. Its satisfiable set is a single
// window — the building block for the disjoint-union / list-intersection cases.
const range = (
  lo: OCTDate,
  hi: OCTDate,
  loStrict = false,
  hiStrict = false,
): Condition => and(atom("AFTER", lo, loStrict), atom("BEFORE", hi, hiStrict));

// Expected-shape constructors. `satisfiableSet` returns Window[] whose edges are
// { date, strict }; a missing edge is just an absent key, and `toEqual` ignores
// the undefined ones, so passing `undefined` for an unbounded side matches.
const bnd = (date: OCTDate, strict = false) => ({ date, strict });
const win = (
  lower: { date: OCTDate; strict: boolean } | undefined,
  upper: { date: OCTDate; strict: boolean } | undefined,
) => ({ lower, upper });

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

describe("satisfiableSet — union of multiple ranges (OR)", () => {
  it("OR of two disjoint ranges keeps both, sorted by lower edge", () => {
    const gate = or(
      range("2025-01-01", "2025-03-01"),
      range("2025-06-01", "2025-08-01"),
    );
    expect(satisfiableSet(gate)).toEqual([
      win(bnd("2025-01-01"), bnd("2025-03-01")),
      win(bnd("2025-06-01"), bnd("2025-08-01")),
    ]);
    expect(isEmptySatisfiableSet(gate)).toBe(false);
  });

  it("OR sorts the ranges regardless of the order they're written", () => {
    // Same two disjoint ranges as above, but written later-first: the sort has to
    // reorder them, so the output is identical.
    const gate = or(
      range("2025-06-01", "2025-08-01"),
      range("2025-01-01", "2025-03-01"),
    );
    expect(satisfiableSet(gate)).toEqual([
      win(bnd("2025-01-01"), bnd("2025-03-01")),
      win(bnd("2025-06-01"), bnd("2025-08-01")),
    ]);
  });

  it("OR of overlapping ranges merges, extending to the later upper", () => {
    const gate = or(
      range("2025-01-01", "2025-04-01"),
      range("2025-03-01", "2025-06-01"),
    );
    expect(satisfiableSet(gate)).toEqual([
      win(bnd("2025-01-01"), bnd("2025-06-01")),
    ]);
  });

  it("OR where the first range contains the second keeps the wider upper", () => {
    const gate = or(
      range("2025-01-01", "2025-08-01"),
      range("2025-03-01", "2025-05-01"),
    );
    expect(satisfiableSet(gate)).toEqual([
      win(bnd("2025-01-01"), bnd("2025-08-01")),
    ]);
  });

  it("OR of ranges that share a boundary day (non-strict) merges into one", () => {
    const gate = or(
      range("2025-01-01", "2025-03-01"),
      range("2025-03-01", "2025-05-01"),
    );
    expect(satisfiableSet(gate)).toEqual([
      win(bnd("2025-01-01"), bnd("2025-05-01")),
    ]);
  });

  it("OR of ranges strict on both sides of the shared day leaves a hole", () => {
    // `..2025-03-01) ∪ (2025-03-01..` excludes the shared day from both sides, so
    // nothing covers it — the two ranges stay disjoint.
    const gate = or(
      range("2025-01-01", "2025-03-01", false, true),
      range("2025-03-01", "2025-05-01", true, false),
    );
    expect(satisfiableSet(gate)).toEqual([
      win(bnd("2025-01-01"), bnd("2025-03-01", true)),
      win(bnd("2025-03-01", true), bnd("2025-05-01")),
    ]);
    expect(isEmptySatisfiableSet(gate)).toBe(false);
  });

  it("OR of two AFTER bounds keeps the looser (earlier) lower, still open above", () => {
    const gate = or(atom("AFTER", "2025-01-01"), atom("AFTER", "2025-06-01"));
    expect(satisfiableSet(gate)).toEqual([win(bnd("2025-01-01"), undefined)]);
  });

  it("OR of two BEFORE bounds keeps the looser (later) upper, still open below", () => {
    const gate = or(atom("BEFORE", "2025-01-01"), atom("BEFORE", "2025-06-01"));
    expect(satisfiableSet(gate)).toEqual([win(undefined, bnd("2025-06-01"))]);
  });

  it("OR of a BEFORE and a disjoint AFTER half-line stays two open intervals", () => {
    const gate = or(atom("BEFORE", "2025-01-01"), atom("AFTER", "2025-06-01"));
    expect(satisfiableSet(gate)).toEqual([
      win(undefined, bnd("2025-01-01")),
      win(bnd("2025-06-01"), undefined),
    ]);
  });

  it("OR of half-lines is order-independent (upper-only arm sorts first)", () => {
    const gate = or(atom("AFTER", "2025-06-01"), atom("BEFORE", "2025-01-01"));
    expect(satisfiableSet(gate)).toEqual([
      win(undefined, bnd("2025-01-01")),
      win(bnd("2025-06-01"), undefined),
    ]);
  });

  it("OR of a range and an overlapping AFTER half-line opens the upper", () => {
    // The half-line reaches into the range and runs to +∞, so the union is one
    // ray from the range's lower edge.
    const gate = or(
      range("2025-01-01", "2025-06-01"),
      atom("AFTER", "2025-03-01"),
    );
    expect(satisfiableSet(gate)).toEqual([win(bnd("2025-01-01"), undefined)]);
  });
});

describe("satisfiableSet — intersection across interval lists (AND)", () => {
  it("AND of two two-interval unions intersects arm by arm", () => {
    // left = {Jan–Mar} ∪ {Jul–Sep}, right = {Feb–Apr} ∪ {Aug–Oct}. Only the
    // aligned arms overlap; the cross pairs (Jul–Sep ∩ Feb–Apr, etc.) are empty
    // and drop out of the linear sweep.
    const gate = and(
      or(range("2025-01-01", "2025-03-01"), range("2025-07-01", "2025-09-01")),
      or(range("2025-02-01", "2025-04-01"), range("2025-08-01", "2025-10-01")),
    );
    expect(satisfiableSet(gate)).toEqual([
      win(bnd("2025-02-01"), bnd("2025-03-01")),
      win(bnd("2025-08-01"), bnd("2025-09-01")),
    ]);
  });

  it("AND clips an unbounded-above OR arm against a BEFORE bound", () => {
    const gate = and(
      or(range("2025-01-01", "2025-03-01"), atom("AFTER", "2025-07-01")),
      atom("BEFORE", "2025-08-01"),
    );
    expect(satisfiableSet(gate)).toEqual([
      win(bnd("2025-01-01"), bnd("2025-03-01")),
      win(bnd("2025-07-01"), bnd("2025-08-01")),
    ]);
  });

  it("AND clips the unbounded-above arm when it is the right operand", () => {
    // Same result as above with the operands swapped — exercises the other branch
    // of the sweep's advance (retire the right range on an unbounded upper).
    const gate = and(
      atom("BEFORE", "2025-08-01"),
      or(range("2025-01-01", "2025-03-01"), atom("AFTER", "2025-07-01")),
    );
    expect(satisfiableSet(gate)).toEqual([
      win(bnd("2025-01-01"), bnd("2025-03-01")),
      win(bnd("2025-07-01"), bnd("2025-08-01")),
    ]);
  });
});

describe("satisfiableSet — strictness and day-granularity edges", () => {
  it("AND of equal-date AFTER bounds keeps the strict (tighter) lower", () => {
    const gate = and(
      atom("AFTER", "2025-05-01", false),
      atom("AFTER", "2025-05-01", true),
    );
    expect(satisfiableSet(gate)).toEqual([
      win(bnd("2025-05-01", true), undefined),
    ]);
  });

  it("AND of equal-date BEFORE bounds keeps the strict (tighter) upper", () => {
    const gate = and(
      atom("BEFORE", "2025-05-01", false),
      atom("BEFORE", "2025-05-01", true),
    );
    expect(satisfiableSet(gate)).toEqual([
      win(undefined, bnd("2025-05-01", true)),
    ]);
  });

  it("the strict-edge tie-break is order-independent (strict wins either way)", () => {
    // Same equal-date pairs as above but strict-first: the tighter (strict) edge
    // must still win, so the result is identical. Pins the bound comparators'
    // tie-break sign, which the non-strict-first cases alone can't distinguish.
    expect(
      satisfiableSet(
        and(
          atom("AFTER", "2025-05-01", true),
          atom("AFTER", "2025-05-01", false),
        ),
      ),
    ).toEqual([win(bnd("2025-05-01", true), undefined)]);
    expect(
      satisfiableSet(
        and(
          atom("BEFORE", "2025-05-01", true),
          atom("BEFORE", "2025-05-01", false),
        ),
      ),
    ).toEqual([win(undefined, bnd("2025-05-01", true))]);
  });

  it("a strict open interval one day wide admits nothing", () => {
    // (2025-05-01, 2025-05-02) has no integer day strictly between the two — the
    // witness step lands on 05-02 and the strict upper excludes it.
    const gate = and(
      atom("AFTER", "2025-05-01", true),
      atom("BEFORE", "2025-05-02", true),
    );
    expect(satisfiableSet(gate)).toEqual([]);
    expect(isEmptySatisfiableSet(gate)).toBe(true);
  });

  it("a strict lower with a non-strict upper one day later admits that day", () => {
    const gate = and(
      atom("AFTER", "2025-05-01", true),
      atom("BEFORE", "2025-05-02", false),
    );
    expect(satisfiableSet(gate)).toEqual([
      win(bnd("2025-05-01", true), bnd("2025-05-02")),
    ]);
    expect(isEmptySatisfiableSet(gate)).toBe(false);
  });

  it("a strict lower at the last representable day is empty without stepping off the end", () => {
    // `(9999-12-31, 9999-12-31]` is empty; the guard settles it by comparison
    // before computing a witness, which would otherwise step the lower edge past
    // the end of the date range.
    const gate = and(
      atom("AFTER", "9999-12-31", true),
      atom("BEFORE", "9999-12-31", false),
    );
    expect(satisfiableSet(gate)).toEqual([]);
    expect(isEmptySatisfiableSet(gate)).toBe(true);
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

  it("an EVENT base yields the full line, not a bound read off the event id", () => {
    // The base isn't a DATE, so `staticDate` rejects it: the set is the whole line
    // `[{}]`, not a window pinned to the event *name*.
    expect(
      satisfiableSet(atom("AFTER", "2025-01-01", false, eventBase("ipo"))),
    ).toEqual([{}]);
  });

  it("a DATE base carrying an offset is not statically datable", () => {
    // `2025-01-01 + 10 days` resolves through a runtime policy this analysis won't
    // commit to, so the offset node contributes the full line.
    const offsetAtom = datedAtom("2025-01-01", [
      { type: "DURATION", value: 10, unit: "DAYS", sign: "PLUS" },
    ]);
    expect(satisfiableSet(offsetAtom)).toEqual([{}]);
  });

  it("a DATE base carrying its own gate is not statically datable", () => {
    // A gated anchor isn't a fixed point either — full line.
    const gatedAtom = datedAtom("2025-01-01", [], atom("AFTER", "2024-01-01"));
    expect(satisfiableSet(gatedAtom)).toEqual([{}]);
  });
});
