// The interchange verdict — what a record keeper could store for a schedule,
// answered without looking at which events have fired. These pin the properties
// that make it worth having as a separate verdict: it doesn't care how a start is
// spelled, it doesn't move when an event fires, and it parts ways with the
// closed-world verdict exactly where the canonical schema can't hold something.

import { describe, it, expect } from "vitest";
import type {
  Amount,
  EvaluationContextInput,
  Program,
  Statement,
  VestingNode,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";
import { evaluateStatement, evaluateProgram } from "../src/evaluate/index";
import {
  makeSingletonSchedule,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
  makeVestingBaseGrantDate,
  makeGatedNode,
  makeDuration,
} from "./helpers";

const ctxInput = (
  overrides: Partial<EvaluationContextInput> = {},
): EvaluationContextInput => ({
  grantDate: "2025-01-01",
  events: {},
  grantQuantity: 100000,
  asOf: "2026-06-01",
  ...overrides,
});

const portion = (numerator: number, denominator: number): Amount => ({
  type: "PORTION",
  numerator,
  denominator,
});

const stmt = (
  amount: Amount,
  start: VestingNodeExpr<"GRANT_DATE">,
  periodicity: VestingPeriod,
): Statement => ({
  type: "STATEMENT",
  amount,
  expr: makeSingletonSchedule(start, periodicity),
});

const monthly48: VestingPeriod = { type: "MONTHS", length: 1, occurrences: 48 };

describe("interchange — the storable verdict ignores how a start is spelled (#75)", () => {
  // The bug #75 fixes: the same schedule scored differently depending on whether
  // its start was written as a date or as an event. Here a date-anchored start and
  // an event-anchored start that fires on that very date produce the same dated
  // stream — and now they get the same storable verdict (a template), even though
  // one is a date template and the other an event template.
  it("a DATE start and an event firing on that date are both storable as a template", () => {
    const fromDate = evaluateStatement(
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseDate("2030-01-01")),
        monthly48,
      ),
      ctxInput(),
    );
    const fromEvent = evaluateStatement(
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseEvent("ipo")),
        monthly48,
      ),
      ctxInput({ events: { ipo: "2030-01-01" } }),
    );

    expect(fromDate.interchange.status).toBe("template");
    expect(fromEvent.interchange.status).toBe("template");

    // Same dated stream once the event lands on the date — the thing #75 says the
    // verdict must not disagree about.
    const dates = (r: typeof fromDate) =>
      r.resolution.installments.map((i) => i.date);
    expect(dates(fromEvent)).toEqual(dates(fromDate));
  });
});

describe("interchange — firing-invariance", () => {
  // The defining property: an event arriving must not change the storable verdict.
  it("an event-anchored start gives the same interchange verdict fired or not", () => {
    const program: Program = [
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseEvent("ipo")),
        monthly48,
      ),
    ];
    const unfired = evaluateProgram(program, ctxInput()).at(0)!.interchange;
    const fired = evaluateProgram(
      program,
      ctxInput({ events: { ipo: "2027-03-01" } }),
    ).at(0)!.interchange;

    expect(fired).toEqual(unfired);
    expect(unfired.status).toBe("template");
  });
});

describe("interchange — where the two verdicts diverge", () => {
  // An event-anchored cliff: the closed-world view can still list the dated events
  // (so it reads events-only), but the canonical schema has nowhere to put a cliff
  // that hangs off an event, so it isn't storable at all.
  it("an event cliff is events-only to resolve, but unrepresentable to store", () => {
    const out = evaluateStatement(
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        {
          type: "MONTHS",
          length: 1,
          occurrences: 48,
          cliff: makeSingletonNode(makeVestingBaseEvent("ipo")),
        },
      ),
      ctxInput({ events: { ipo: "2026-01-01" } }),
    );

    expect(out.resolution.status).toBe("events-only");
    expect(out.interchange.status).toBe("unrepresentable");
  });

  // The same event cliff before its event fires: the closed-world view now reads
  // pending (the whole grid waits on the firing), while the storable answer keeps
  // the precise reason — the schema has no home for an event-anchored cliff, not
  // merely a cliff that can't be placed yet.
  it("an unfired event cliff is unresolved to resolve, unrepresentable (EVENT_CLIFF) to store", () => {
    const out = evaluateStatement(
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        {
          type: "MONTHS",
          length: 1,
          occurrences: 48,
          cliff: makeSingletonNode(makeVestingBaseEvent("ipo")),
        },
      ),
      ctxInput(),
    );

    expect(out.resolution.status).toBe("unresolved");
    expect(out.interchange.status).toBe("unrepresentable");
    if (out.interchange.status !== "unrepresentable") return;
    expect(out.interchange.reason).toEqual({
      kind: "EVENT_CLIFF",
      eventId: "ipo",
    });
  });

  // Storability can't depend on the firing: the event-cliff schedule gets the
  // identical interchange verdict whether ipo has fired or not.
  it("the event-cliff interchange verdict is firing-invariant", () => {
    const s = stmt(
      portion(1, 1),
      makeSingletonNode(makeVestingBaseDate("2025-01-01")),
      {
        type: "MONTHS",
        length: 1,
        occurrences: 48,
        cliff: makeSingletonNode(makeVestingBaseEvent("ipo")),
      },
    );
    const unfired = evaluateStatement(s, ctxInput()).interchange;
    const fired = evaluateStatement(
      s,
      ctxInput({ events: { ipo: "2026-01-01" } }),
    ).interchange;

    expect(fired).toEqual(unfired);
    expect(unfired).toEqual({
      status: "unrepresentable",
      reason: { kind: "EVENT_CLIFF", eventId: "ipo" },
    });
  });

  // A gated event cliff (#113): the gate is enforced, and the two verdicts split
  // on it the way they should. Closed-world, the firing violates the gate so the
  // cliff can never validly land (impossible); firing-blind, the gate is merely
  // pending, so the cliff just can't be placed yet (unrepresentable, not a
  // contradiction).
  it("a gated event cliff is impossible to resolve when the firing violates the gate, unrepresentable to store", () => {
    // CLIFF EVENT acquisition AFTER grantDate + 1 year, acquisition firing before
    // grantDate + 1 year → the cliff gate is violated.
    const gatedCliff = makeGatedNode(
      makeVestingBaseEvent("acquisition"),
      "AFTER",
      makeSingletonNode(makeVestingBaseGrantDate(), [
        makeDuration(12, "MONTHS", "PLUS"),
      ]),
    );
    const out = evaluateStatement(
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        {
          type: "MONTHS",
          length: 1,
          occurrences: 48,
          cliff: gatedCliff,
        },
      ),
      ctxInput({ events: { acquisition: "2025-06-01" } }),
    );

    expect(out.resolution.status).toBe("impossible");
    expect(out.interchange.status).toBe("unrepresentable");
  });

  // Two independent date grids: nothing event-dependent, so both verdicts agree
  // it's events-only — storable as a flat list of dated events, just not as one
  // template.
  it("two independent date grids are events-only under both lenses", () => {
    const program: Program = [
      stmt(
        portion(1, 2),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        {
          type: "MONTHS",
          length: 12,
          occurrences: 1,
        },
      ),
      stmt(
        portion(1, 2),
        makeSingletonNode(makeVestingBaseDate("2025-07-01")),
        {
          type: "MONTHS",
          length: 12,
          occurrences: 1,
        },
      ),
    ];
    const [out] = evaluateProgram(program, ctxInput());
    expect(out.resolution.status).toBe("events-only");
    expect(out.interchange.status).toBe("events-only");
  });
});

describe("interchange — allocation is its own axis", () => {
  // Over-allocation and impossibility are two separate authoring mistakes; one
  // shouldn't hide the other. A program that is both over-allocated and impossible
  // closed-world must still report the over-allocation.
  it("an over-allocating, impossible program still reports over-allocation", () => {
    // `FROM EVENT a BEFORE 2025-01-01` with `a` firing after the deadline can never
    // be satisfied — and two full-grant portions of it sum to 200%.
    const voidStart: VestingNode<"GRANT_DATE"> = {
      type: "NODE",
      base: makeVestingBaseEvent("a"),
      offsets: [],
      condition: {
        type: "ATOM",
        constraint: {
          type: "BEFORE",
          base: makeSingletonNode(makeVestingBaseDate("2025-01-01")),
          strict: false,
        },
      },
    };
    const voidStmt = stmt(portion(1, 1), voidStart, {
      type: "MONTHS",
      length: 12,
      occurrences: 2,
    });

    const [out] = evaluateProgram(
      [voidStmt, voidStmt],
      ctxInput({ grantDate: "2025-01-01", events: { a: "2025-06-01" } }),
    );

    expect(out.resolution.status).toBe("impossible");
    expect(out.findings.some((f) => f.kind === "over-allocation")).toBe(true);
  });
});
