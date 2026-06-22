// Closed-world resolution reads "no firing recorded" as "hasn't happened," so its
// answer can quietly depend on some event staying absent. `absenceAssumptions`
// surfaces those dependencies: one { eventId, through } per event the resolution is
// taking to be absent on/before a particular date. A schedule that needs no such
// assumption (all dates, or every event already fired) discloses nothing.
//
// What counts as a disclosed assumption is the dated kind: the event was held
// against a known date — a gate's before/after, or the date a LATER OF already
// settled on. A bare wait with nothing to compare against (a plain FROM EVENT) is
// still pending, but it has no date to disclose, so it stays in the blocker list.

import { describe, it, expect } from "vitest";
import type {
  Amount,
  ResolutionContextInput,
  OCTDate,
  Program,
  Statement,
  VestingNode,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";
import { evaluateStatement, evaluateProgram } from "../src/evaluate";
import {
  makeSingletonSchedule,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
} from "./helpers";

const ctxInput = (
  overrides: Partial<ResolutionContextInput> = {},
): ResolutionContextInput => ({
  grantDate: "2025-01-01",
  events: {},
  grantQuantity: 100000,
  ...overrides,
});

const portion = (numerator: number, denominator: number): Amount => ({
  type: "PORTION",
  numerator,
  denominator,
});

const monthly: VestingPeriod = { type: "MONTHS", length: 1, occurrences: 48 };

const stmt = (
  amount: Amount,
  start: VestingNodeExpr<"GRANT_DATE">,
): Statement => ({
  type: "STATEMENT",
  amount,
  expr: makeSingletonSchedule(start, monthly),
});

// `FROM DATE <date> BEFORE EVENT <event>` — vest from a fixed date, on the
// understanding that the date lands before the event. While the event is unfired
// the test can't be settled, so the start stays pending and leans on the event
// not having occurred by that date.
const dateBeforeEvent = (
  date: OCTDate,
  event: string,
): VestingNode<"GRANT_DATE"> => ({
  type: "NODE",
  base: makeVestingBaseDate(date),
  offsets: [],
  condition: {
    type: "ATOM",
    constraint: {
      type: "BEFORE",
      base: makeSingletonNode(makeVestingBaseEvent(event)),
      strict: false,
    },
  },
});

describe("absenceAssumptions", () => {
  it("two starts gated on different events disclose both, each with its own date", () => {
    const program: Program = [
      stmt(portion(1, 2), dateBeforeEvent("2025-01-01", "ipo")),
      stmt(portion(1, 2), dateBeforeEvent("2026-03-01", "milestone")),
    ];
    const out = evaluateProgram(program, ctxInput());
    expect(out.absenceAssumptions).toEqual([
      { eventId: "ipo", through: "2025-01-01" },
      { eventId: "milestone", through: "2026-03-01" },
    ]);
  });

  it("a plain date schedule assumes nothing", () => {
    const out = evaluateStatement(
      stmt(portion(1, 1), makeSingletonNode(makeVestingBaseDate("2025-01-01"))),
      ctxInput(),
    );
    expect(out.absenceAssumptions).toEqual([]);
  });

  it("once the gating event has fired there is no assumption left", () => {
    // ipo fired in 2030, comfortably after the 2025 start, so the before-test is
    // settled and the start just resolves — nothing is being assumed absent.
    const out = evaluateStatement(
      stmt(portion(1, 1), dateBeforeEvent("2025-01-01", "ipo")),
      ctxInput({ events: { ipo: "2030-01-01" } }),
    );
    expect(out.absenceAssumptions).toEqual([]);
  });

  it("a bare unfired-event start has no date to disclose, only a blocker", () => {
    const out = evaluateStatement(
      stmt(portion(1, 1), makeSingletonNode(makeVestingBaseEvent("ipo"))),
      ctxInput(),
    );
    // The wait on ipo is real, but there's no date it was measured against, so it
    // isn't a dated assumption — it surfaces as a blocker instead.
    expect(out.absenceAssumptions).toEqual([]);
    expect(
      out.resolution.pending.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
  });

  it("a LATER OF settled on a date assumes the pending arm stays absent through it", () => {
    // LATER OF ( DATE 2027-01-01, EVENT ipo ): the date has settled but ipo could
    // still land later and become the answer, so the result holds at 2027-01-01
    // only as long as ipo stays absent through that date.
    const laterOf: VestingNodeExpr<"GRANT_DATE"> = {
      type: "NODE_LATER_OF",
      items: [
        makeSingletonNode(makeVestingBaseDate("2027-01-01")),
        makeSingletonNode(makeVestingBaseEvent("ipo")),
      ],
    };
    const program: Program = [
      {
        type: "STATEMENT",
        amount: portion(1, 1),
        expr: {
          type: "SCHEDULE",
          vesting_start: laterOf,
          periodicity: monthly,
        },
      },
    ];
    const out = evaluateProgram(program, ctxInput());
    expect(out.absenceAssumptions).toEqual([
      { eventId: "ipo", through: "2027-01-01" },
    ]);
  });

  it("the same event assumed absent against two dates collapses to the later one", () => {
    const program: Program = [
      stmt(portion(1, 2), dateBeforeEvent("2025-01-01", "ipo")),
      stmt(portion(1, 2), dateBeforeEvent("2026-03-01", "ipo")),
    ];
    const out = evaluateProgram(program, ctxInput());
    expect(out.absenceAssumptions).toEqual([
      { eventId: "ipo", through: "2026-03-01" },
    ]);
  });
});
