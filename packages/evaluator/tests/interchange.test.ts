// The interchange verdict — what a record keeper could store for a schedule,
// answered without looking at which events have fired. These pin the properties
// that make it worth having as a separate verdict: it doesn't care how a start is
// spelled, it doesn't move when an event fires, and it parts ways with the
// closed-world verdict exactly where the canonical schema can't hold something.

import { describe, it, expect } from "vitest";
import { CONTINGENT_START_SENTINEL } from "@vestlang/core";
import type {
  Amount,
  ResolutionContextInput,
  Program,
  Statement,
  VestingNode,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";
import { evaluateStatement, evaluateProgram } from "../src/orchestrate";
import {
  makeSingletonSchedule,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
  makeVestingBaseGrantDate,
  makeVestingBaseVestingStart,
  makeGatedNode,
  makeDuration,
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
      r.resolution.installments.flatMap((i) =>
        i.state === "RESOLVED" ? [i.date] : [],
      );
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
    const unfired = evaluateProgram(program, ctxInput()).interchange;
    const fired = evaluateProgram(
      program,
      ctxInput({ events: { ipo: "2027-03-01" } }),
    ).interchange;

    expect(fired).toEqual(unfired);
    expect(unfired.status).toBe("template");
  });
});

describe("interchange — an event-held cliff stores as a template under both lenses (#255)", () => {
  // An event-held cliff stores as a time `cliff` + an `event_condition` (Carta's
  // HYBRID model), so BOTH verdicts read template now — they no longer split
  // events-only/unrepresentable. The resolution folds at the firing; the
  // interchange is firing-blind and holds.
  it("a fired event cliff is a template under both lenses", () => {
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

    expect(out.resolution.status).toBe("template");
    expect(out.interchange.status).toBe("template");
    if (out.interchange.status !== "template") return;
    expect(out.interchange.template.statements[0].event_condition).toEqual({
      event_id: "ipo",
    });
  });

  // The same cliff before its event fires: still a template (storability doesn't
  // depend on firings), and the held grid projects nothing under resolution.
  it("an unfired event cliff is a template under both lenses; resolution holds", () => {
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

    expect(out.resolution.status).toBe("template");
    expect(out.interchange.status).toBe("template");
    expect(
      out.resolution.pending.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
  });

  // AC 8: storability can't depend on the firing — the interchange verdict is
  // byte-identical whether ipo has fired or not (deep-equal).
  it("the event-cliff interchange verdict is firing-invariant (deep-equal fired vs unfired)", () => {
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
    expect(unfired.status).toBe("template");
    if (unfired.status !== "template") return;
    // Firing-blind: no firings baked into the stored runtime.
    expect(unfired.runtime.eventFirings).toBeUndefined();
    expect(unfired.template.statements[0].event_condition).toEqual({
      event_id: "ipo",
    });
  });

  // A gated event cliff (#113/#255): the gate is captured in a synthetic recipe, so
  // the interchange stores a template regardless. Closed-world, the firing violates
  // the gate → the resolution is impossible (the two-verdict split, AC 10).
  it("a gated event cliff with a violated firing: impossible to resolve, template to store", () => {
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
    // Firing-blind, the gate is uncaptured-as-a-verdict, so the synthetic
    // event_condition just holds → a storable template.
    expect(out.interchange.status).toBe("template");
    if (out.interchange.status !== "template") return;
    expect(
      out.interchange.template.statements[0].event_condition?.event_id,
    ).toMatch(/^evt:\d+$/);
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
    const out = evaluateProgram(program, ctxInput());
    expect(out.resolution.status).toBe("events-only");
    expect(out.interchange.status).toBe("events-only");
  });
});

describe("interchange — distinguishing why an unresolved build is unstorable", () => {
  // A THEN tail behind an unfired event head, with no cliff anywhere. The chain is
  // headed on ONE event — a single contingent origin — so it now stores as a
  // contingent-start `template` (sentinel + `evt:start` recipe), with both segments
  // re-anchoring off the resolved start on reload. (It was EVENT_CHAINED_TAIL /
  // unrepresentable before the contingent-start model.)
  it("a no-cliff chained tail behind a single pending event head is a contingent template", () => {
    const monthly2: VestingPeriod = {
      type: "MONTHS",
      length: 1,
      occurrences: 2,
    };
    const program: Program = [
      {
        type: "STATEMENT",
        amount: portion(1, 2),
        expr: makeSingletonSchedule(
          makeSingletonNode(makeVestingBaseEvent("ipo")),
          monthly2,
        ),
      },
      {
        type: "STATEMENT",
        chained: true,
        amount: portion(1, 2),
        expr: { type: "SCHEDULE", vesting_start: null, periodicity: monthly2 },
      },
    ];

    const out = evaluateProgram(program, ctxInput());
    expect(out.interchange.status).toBe("template");
    if (out.interchange.status !== "template") return;
    expect(out.interchange.template.statements).toHaveLength(2);
    expect(out.interchange.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(Object.keys(out.interchange.sourceMap)).toEqual(["evt:start"]);
  });

  // A cliff that genuinely can't be placed until a firing is known — a
  // `vestingStart + N months` cliff over a days grid, whose pre-cliff count
  // depends on the (unfired) anchor — keeps DEFERRED_CLIFF.
  it("a cliff that can't be placed until a firing is known stays DEFERRED_CLIFF", () => {
    const out = evaluateStatement(
      stmt(portion(1, 1), makeSingletonNode(makeVestingBaseEvent("ipo")), {
        type: "DAYS",
        length: 30,
        occurrences: 48,
        // months cliff over a days grid: cross-unit, so the pre-cliff share
        // can't be derived anchor-free and the unfired build stays unresolved.
        cliff: makeSingletonNode(makeVestingBaseVestingStart(), [
          makeDuration(12, "MONTHS", "PLUS"),
        ]),
      }),
      ctxInput(),
    );

    expect(out.interchange.status).toBe("unrepresentable");
    if (out.interchange.status !== "unrepresentable") return;
    expect(out.interchange.reason).toEqual({ kind: "DEFERRED_CLIFF" });
  });

  // An event-anchored cliff on a dated start stores as a template now (the
  // event_condition), firing-blind where the cliff event never reads as fired.
  it("an event cliff on a dated start stores as a template (event_condition)", () => {
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

    expect(out.interchange.status).toBe("template");
    if (out.interchange.status !== "template") return;
    expect(out.interchange.template.statements[0].event_condition).toEqual({
      event_id: "ipo",
    });
  });

  // An event cliff behind a *pending* event start → a COMPOUND template (AC 11):
  // a contingent start (sentinel + evt:start recipe) AND the cliff's event_condition.
  // Both halves store, so the interchange is a template, not unrepresentable.
  it("an event cliff behind a pending event start → compound template", () => {
    const out = evaluateStatement(
      stmt(portion(1, 1), makeSingletonNode(makeVestingBaseEvent("ipo")), {
        type: "MONTHS",
        length: 1,
        occurrences: 48,
        cliff: makeSingletonNode(makeVestingBaseEvent("acquisition")),
      }),
      ctxInput(),
    );

    expect(out.interchange.status).toBe("template");
    if (out.interchange.status !== "template") return;
    expect(out.interchange.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(Object.keys(out.interchange.sourceMap)).toEqual(["evt:start"]);
    expect(out.interchange.template.statements[0].event_condition).toEqual({
      event_id: "acquisition",
    });
  });

  // The cliff's event_condition is the same whether the start is pending or a fixed
  // date — the cliff lowering is start-independent. (The start half differs: a
  // pending start hoists the sentinel + evt:start; a date start hoists the date.)
  it("the cliff's event_condition is the same behind a pending start as behind a date start", () => {
    const periodicity: VestingPeriod = {
      type: "MONTHS",
      length: 1,
      occurrences: 48,
      cliff: makeSingletonNode(makeVestingBaseEvent("acquisition")),
    };
    const pendingStart = evaluateStatement(
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseEvent("ipo")),
        periodicity,
      ),
      ctxInput(),
    ).interchange;
    const dateStart = evaluateStatement(
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        periodicity,
      ),
      ctxInput(),
    ).interchange;

    expect(pendingStart.status).toBe("template");
    expect(dateStart.status).toBe("template");
    if (pendingStart.status !== "template" || dateStart.status !== "template")
      return;
    const ec = { event_id: "acquisition" };
    expect(pendingStart.template.statements[0].event_condition).toEqual(ec);
    expect(dateStart.template.statements[0].event_condition).toEqual(ec);
  });

  // The resolution side holds both contingencies: nothing vests until BOTH the
  // start event (ipo) and the cliff event (acquisition) fire. Both are disclosed.
  it("a pending start with an event cliff holds on both events (resolution)", () => {
    const out = evaluateStatement(
      stmt(portion(1, 1), makeSingletonNode(makeVestingBaseEvent("ipo")), {
        type: "MONTHS",
        length: 1,
        occurrences: 48,
        cliff: makeSingletonNode(makeVestingBaseEvent("acquisition")),
      }),
      ctxInput(),
    );

    expect(out.resolution.status).toBe("template");
    if (out.resolution.status !== "template") return;
    // Held to nothing while the start is pending.
    expect(
      out.resolution.installments.every((i) => i.state !== "RESOLVED"),
    ).toBe(true);
    expect(out.resolution.dead).toHaveLength(0);
    // Both contingencies are disclosed as pending.
    const pendingEvents = out.resolution.pending.flatMap((b) =>
      b.type === "EVENT_NOT_YET_OCCURRED" ? [b.event] : [],
    );
    expect(pendingEvents).toContain("ipo");
    expect(pendingEvents).toContain("acquisition");
  });

  // A gated event cliff behind a pending start → compound template, the cliff side
  // a synthetic event_condition (the gate captured in its recipe).
  it("a gated event cliff behind a pending start → compound template, synthetic cliff condition", () => {
    const gatedCliff = makeGatedNode(
      makeVestingBaseEvent("acquisition"),
      "AFTER",
      makeSingletonNode(makeVestingBaseGrantDate(), [
        makeDuration(12, "MONTHS", "PLUS"),
      ]),
    );
    const out = evaluateStatement(
      stmt(portion(1, 1), makeSingletonNode(makeVestingBaseEvent("ipo")), {
        type: "MONTHS",
        length: 1,
        occurrences: 48,
        cliff: gatedCliff,
      }),
      ctxInput(),
    );

    expect(out.interchange.status).toBe("template");
    if (out.interchange.status !== "template") return;
    expect(
      out.interchange.template.statements[0].event_condition?.event_id,
    ).toMatch(/^evt:\d+$/);
  });

  // AC 8: the gated event cliff's interchange verdict is firing-invariant
  // (deep-equal whether the event has fired and cleared the gate or not).
  it("the gated-event-cliff interchange verdict is firing-invariant (deep-equal)", () => {
    const s = stmt(
      portion(1, 1),
      makeSingletonNode(makeVestingBaseDate("2025-01-01")),
      {
        type: "MONTHS",
        length: 1,
        occurrences: 48,
        cliff: makeGatedNode(
          makeVestingBaseEvent("ipo"),
          "AFTER",
          makeSingletonNode(makeVestingBaseDate("2026-01-01")),
        ),
      },
    );
    const unfired = evaluateStatement(s, ctxInput()).interchange;
    const fired = evaluateStatement(
      s,
      ctxInput({ events: { ipo: "2026-06-01" } }), // fires after the gate date — gate satisfied
    ).interchange;

    expect(fired).toEqual(unfired);
    expect(unfired.status).toBe("template");
    if (unfired.status !== "template") return;
    expect(unfired.template.statements[0].event_condition?.event_id).toMatch(
      /^evt:\d+$/,
    );
  });
});

describe("interchange — a pending-head THEN tail's cliff decides the reason (R2-B3)", () => {
  const monthly12: VestingPeriod = {
    type: "MONTHS",
    length: 1,
    occurrences: 12,
  };
  // A THEN tail has no start of its own; the chaining walk injects it.
  const tail = (periodicity: VestingPeriod): Statement => ({
    type: "STATEMENT",
    chained: true,
    amount: portion(1, 2),
    expr: { type: "SCHEDULE", vesting_start: null, periodicity },
  });
  const chain = (tailPeriodicity: VestingPeriod): Program => [
    stmt(
      portion(1, 2),
      makeSingletonNode(makeVestingBaseEvent("ipo")),
      monthly12,
    ),
    tail(tailPeriodicity),
  ];

  // The tail's event cliff stores as an event_condition now, and the chain is
  // headed on one contingent event start → a compound template (sentinel +
  // evt:start, plus the tail's event_condition), not EVENT_CHAINED_TAIL.
  it("a bare event cliff on the tail → compound template (event_condition on the tail)", () => {
    const out = evaluateProgram(
      chain({
        ...monthly12,
        cliff: makeSingletonNode(makeVestingBaseEvent("fda")),
      }),
      ctxInput(),
    );
    expect(out.interchange.status).toBe("template");
    if (out.interchange.status !== "template") return;
    expect(out.interchange.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(Object.keys(out.interchange.sourceMap)).toEqual(["evt:start"]);
    expect(out.interchange.template.statements[1].event_condition).toEqual({
      event_id: "fda",
    });
  });

  it("the tail event-cliff verdict is firing-invariant", () => {
    const program = chain({
      ...monthly12,
      cliff: makeSingletonNode(makeVestingBaseEvent("fda")),
    });
    const unfired = evaluateProgram(program, ctxInput()).interchange;
    const fired = evaluateProgram(
      program,
      ctxInput({ events: { ipo: "2026-06-01" } }),
    ).interchange;
    expect(fired).toEqual(unfired);
  });

  // A grid-unit duration cliff lowers anchor-free to a storable time-based cliff
  // (6/12 regardless of when ipo fires), and the chain is headed on ONE event — a
  // single contingent origin — so the whole thing now stores as a contingent-start
  // template (sentinel + `evt:start`), tail cliff and all. (It was
  // EVENT_CHAINED_TAIL / unrepresentable before the contingent-start model.)
  it("a grid-unit duration cliff on the tail keeps it a contingent template", () => {
    const out = evaluateProgram(
      chain({
        ...monthly12,
        cliff: makeSingletonNode(makeVestingBaseVestingStart(), [
          makeDuration(6, "MONTHS", "PLUS"),
        ]),
      }),
      ctxInput(),
    );
    expect(out.interchange.status).toBe("template");
    if (out.interchange.status !== "template") return;
    expect(out.interchange.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(Object.keys(out.interchange.sourceMap)).toEqual(["evt:start"]);
    // The tail's grid-unit duration cliff survives onto the second statement.
    expect(out.interchange.template.statements[1].cliff).toBeDefined();
  });

  // A months cliff over a days grid can't be placed until the firing is known —
  // the cliff cause wins over the tail one, same as the non-chained analog above.
  it("a cross-unit duration cliff on the tail reports DEFERRED_CLIFF", () => {
    const out = evaluateProgram(
      chain({
        type: "DAYS",
        length: 30,
        occurrences: 12,
        cliff: makeSingletonNode(makeVestingBaseVestingStart(), [
          makeDuration(12, "MONTHS", "PLUS"),
        ]),
      }),
      ctxInput(),
    );
    expect(out.interchange.status).toBe("unrepresentable");
    if (out.interchange.status !== "unrepresentable") return;
    expect(out.interchange.reason).toEqual({ kind: "DEFERRED_CLIFF" });
  });

  // A gated duration cliff routes through the gate's verdict (UNRESOLVED), so
  // the storable reason is DEFERRED_CLIFF. A gated *event* cliff keeps EVENT_CLIFF
  // instead (next test) — only an event-free gate is a deferred cliff.
  it("a gated duration cliff on the tail reports DEFERRED_CLIFF", () => {
    const gatedCliff = makeGatedNode(
      makeVestingBaseVestingStart(),
      "AFTER",
      makeSingletonNode(makeVestingBaseGrantDate(), [
        makeDuration(6, "MONTHS", "PLUS"),
      ]),
      false,
      [makeDuration(6, "MONTHS", "PLUS")],
    );
    const out = evaluateProgram(
      chain({ ...monthly12, cliff: gatedCliff }),
      ctxInput(),
    );
    expect(out.interchange.status).toBe("unrepresentable");
    if (out.interchange.status !== "unrepresentable") return;
    expect(out.interchange.reason).toEqual({ kind: "DEFERRED_CLIFF" });
  });

  // R2-B14: a gated tail event cliff lowers to a SYNTHETIC event_condition (the gate
  // captured in its recipe), so the chain stores as a compound template, not
  // EVENT_CHAINED_TAIL/unrepresentable.
  it("a gated event cliff on the tail → compound template, synthetic condition (R2-B14)", () => {
    const gatedEventCliff = makeGatedNode(
      makeVestingBaseEvent("fda"),
      "AFTER",
      makeSingletonNode(makeVestingBaseGrantDate(), [
        makeDuration(6, "MONTHS", "PLUS"),
      ]),
    );
    const out = evaluateProgram(
      chain({ ...monthly12, cliff: gatedEventCliff }),
      ctxInput(),
    );
    expect(out.interchange.status).toBe("template");
    if (out.interchange.status !== "template") return;
    expect(
      out.interchange.template.statements[1].event_condition?.event_id,
    ).toMatch(/^evt:\d+$/);
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

    const out = evaluateProgram(
      [voidStmt, voidStmt],
      ctxInput({ grantDate: "2025-01-01", events: { a: "2025-06-01" } }),
    );

    expect(out.resolution.status).toBe("impossible");
    expect(out.findings.some((f) => f.kind === "over-allocation")).toBe(true);
  });
});
