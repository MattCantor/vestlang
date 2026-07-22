import { describe, it, expect } from "vitest";
import type {
  Condition,
  ConstraintTag,
  DurationDay,
  DurationMonth,
  Offsets,
  VestingBase,
  VestingNode,
} from "@vestlang/types";
import {
  analyzeSameAnchorGate,
  classifyOffsetDelta,
  isReflexiveContradiction,
  isSameAnchorImpossible,
  type OffsetSign,
} from "../src/same-anchor";

// The firing-invariant same-anchor analysis. Its whole reason to exist is the
// soundness floor — it may only ever under-report — so the sign classifier is the
// load-bearing piece, tested here directly over the full matrix.

/* ------------------------
 * AST construction helpers
 * ------------------------ */

const mo = (value: number, sign: "PLUS" | "MINUS" = "PLUS"): DurationMonth => ({
  type: "DURATION",
  value,
  unit: "MONTHS",
  sign,
});
const day = (value: number, sign: "PLUS" | "MINUS" = "PLUS"): DurationDay => ({
  type: "DURATION",
  value,
  unit: "DAYS",
  sign,
});

const evt = (value: string): VestingBase => ({ type: "EVENT", value });
const grant = (): VestingBase => ({ type: "GRANT_DATE" });
const date = (value: string): VestingBase => ({ type: "DATE", value });

const node = (
  base: VestingBase,
  offsets: Offsets = [],
  condition?: Condition,
): VestingNode => ({ type: "NODE", base, offsets, condition });

const atom = (
  rel: ConstraintTag,
  operand: VestingNode,
  strict = false,
): Condition => ({
  type: "ATOM",
  constraint: { type: rel, base: operand, strict },
});
const and = (...items: Condition[]): Condition =>
  ({ type: "AND", items }) as Condition;
const or = (...items: Condition[]): Condition =>
  ({ type: "OR", items }) as Condition;

/* ------------------------
 * The sign classifier + reflexive table (the primary no-false-positive guard)
 * ------------------------ */

describe("classifyOffsetDelta", () => {
  it("calls both components zero ZERO", () => {
    expect(classifyOffsetDelta(0, 0)).toBe("ZERO");
  });

  it("calls a same-signed non-zero delta POSITIVE or NEGATIVE by its direction", () => {
    for (const [m, d] of [
      [1, 0],
      [0, 1],
      [1, 1],
      [12, 30],
    ]) {
      expect(classifyOffsetDelta(m, d)).toBe("POSITIVE");
    }
    for (const [m, d] of [
      [-1, 0],
      [0, -1],
      [-1, -1],
      [-12, -30],
    ]) {
      expect(classifyOffsetDelta(m, d)).toBe("NEGATIVE");
    }
  });

  it("abstains (INDETERMINATE) on a mixed-sign month+day delta", () => {
    for (const [m, d] of [
      [1, -1],
      [-1, 1],
      [1, -29],
      [-2, 3],
    ]) {
      expect(classifyOffsetDelta(m, d)).toBe("INDETERMINATE");
    }
  });
});

// The check-(A) table: given the sign of `operand − subject`, when is `S REL
// operand` determinately false? An indeterminate delta must NEVER flag — that is
// the soundness floor in one assertion.
describe("isReflexiveContradiction — the full sign × (relation, strict) matrix", () => {
  const expected: Record<
    OffsetSign,
    { rel: ConstraintTag; strict: boolean; flag: boolean }[]
  > = {
    ZERO: [
      { rel: "AFTER", strict: false, flag: false },
      { rel: "AFTER", strict: true, flag: true },
      { rel: "BEFORE", strict: false, flag: false },
      { rel: "BEFORE", strict: true, flag: true },
    ],
    POSITIVE: [
      { rel: "AFTER", strict: false, flag: true },
      { rel: "AFTER", strict: true, flag: true },
      { rel: "BEFORE", strict: false, flag: false },
      { rel: "BEFORE", strict: true, flag: false },
    ],
    NEGATIVE: [
      { rel: "AFTER", strict: false, flag: false },
      { rel: "AFTER", strict: true, flag: false },
      { rel: "BEFORE", strict: false, flag: true },
      { rel: "BEFORE", strict: true, flag: true },
    ],
    INDETERMINATE: [
      { rel: "AFTER", strict: false, flag: false },
      { rel: "AFTER", strict: true, flag: false },
      { rel: "BEFORE", strict: false, flag: false },
      { rel: "BEFORE", strict: true, flag: false },
    ],
  };

  for (const sign of Object.keys(expected) as OffsetSign[]) {
    for (const { rel, strict, flag } of expected[sign]) {
      it(`${rel}${strict ? " (strict)" : ""} on a ${sign} delta ${
        flag ? "flags" : "abstains"
      }`, () => {
        expect(isReflexiveContradiction(rel, strict, sign)).toBe(flag);
      });
    }
  }
});

/* ------------------------
 * The node-level analysis
 * ------------------------ */

describe("analyzeSameAnchorGate — reflexive (check A)", () => {
  it("flags an event strictly after itself", () => {
    const n = node(evt("ipo"), [], atom("AFTER", node(evt("ipo")), true));
    expect(analyzeSameAnchorGate(n).reflexive).toBe(true);
    expect(isSameAnchorImpossible(n)).toBe(true);
  });

  it("flags an event with a determinately-positive offset ahead of itself", () => {
    // a AFTER a + 1 month — the subject can never be at or past a strictly later point.
    const n = node(evt("a"), [], atom("AFTER", node(evt("a"), [mo(1)])));
    expect(analyzeSameAnchorGate(n).reflexive).toBe(true);
  });

  it("flags a system anchor strictly after itself (grantDate)", () => {
    const n = node(grant(), [], atom("AFTER", node(grant()), true));
    expect(analyzeSameAnchorGate(n).reflexive).toBe(true);
  });

  it("does not flag a non-strict self-comparison (zero delta holds)", () => {
    const n = node(evt("ipo"), [], atom("AFTER", node(evt("ipo"))));
    expect(analyzeSameAnchorGate(n).reflexive).toBe(false);
    expect(isSameAnchorImpossible(n)).toBe(false);
  });

  it("does not flag a determinately-negative delta (a - 1 day is behind a)", () => {
    const n = node(
      evt("a"),
      [],
      atom("AFTER", node(evt("a"), [day(1, "MINUS")]), true),
    );
    expect(analyzeSameAnchorGate(n).reflexive).toBe(false);
  });

  it("abstains on an indeterminate (mixed-sign) offset delta", () => {
    // a AFTER a + 1 month - 29 days — the sign can't be settled without month lengths.
    const n = node(
      evt("a"),
      [],
      atom("AFTER", node(evt("a"), [mo(1), day(29, "MINUS")])),
    );
    expect(analyzeSameAnchorGate(n).reflexive).toBe(false);
    expect(isSameAnchorImpossible(n)).toBe(false);
  });

  it("does not flag when the anchors are different symbols", () => {
    const n = node(evt("a"), [], atom("AFTER", node(evt("b")), true));
    expect(analyzeSameAnchorGate(n).reflexive).toBe(false);
  });

  it("ignores a fixed-date anchor (that routes through the date-window analysis)", () => {
    const n = node(
      date("2025-01-01"),
      [],
      atom("AFTER", node(date("2025-01-01")), true),
    );
    expect(isSameAnchorImpossible(n)).toBe(false);
  });
});

describe("analyzeSameAnchorGate — same-operand empty window (check B)", () => {
  it("flags an AFTER/STRICTLY-BEFORE pair against one event with no room between", () => {
    // s AFTER b AND s STRICTLY BEFORE b — b <= s < b is empty.
    const n = node(
      evt("s"),
      [],
      and(atom("AFTER", node(evt("b"))), atom("BEFORE", node(evt("b")), true)),
    );
    const gate = analyzeSameAnchorGate(n);
    expect(gate.emptyWindow).toBe(true);
    expect(gate.reflexive).toBe(false);
    expect(isSameAnchorImpossible(n)).toBe(true);
  });

  it("leaves a live window between two offset bounds against one event", () => {
    // s AFTER b AND s BEFORE b + 1 month — a whole month of room.
    const n = node(
      evt("s"),
      [],
      and(
        atom("AFTER", node(evt("b"))),
        atom("BEFORE", node(evt("b"), [mo(1)])),
      ),
    );
    expect(analyzeSameAnchorGate(n).emptyWindow).toBe(false);
  });

  it("abstains when the window width is an indeterminate offset delta", () => {
    // AFTER b + 1 month AND BEFORE b + 29 days — which bound is tighter needs month lengths.
    const n = node(
      evt("s"),
      [],
      and(
        atom("AFTER", node(evt("b"), [mo(1)])),
        atom("BEFORE", node(evt("b"), [day(29)])),
      ),
    );
    expect(analyzeSameAnchorGate(n).emptyWindow).toBe(false);
  });
});

describe("analyzeSameAnchorGate — OR scoping (a documented under-report)", () => {
  it("does not descend into an OR, even when every arm is self-contradictory", () => {
    // (a STRICTLY AFTER a) OR (a STRICTLY BEFORE a) is firing-invariantly impossible,
    // but the analysis reasons only over the OR-free conjunctive core, so it stays
    // silent here — a sound under-report, never a false positive.
    const n = node(
      evt("a"),
      [],
      or(
        atom("AFTER", node(evt("a")), true),
        atom("BEFORE", node(evt("a")), true),
      ),
    );
    expect(isSameAnchorImpossible(n)).toBe(false);
  });
});
