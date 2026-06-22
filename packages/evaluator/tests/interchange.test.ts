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
  // contradiction). Firing-blind the gate is merely pending, so the storable
  // reason names the structural fact (the event cliff), while the closed-world
  // verdict carries the violation.
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
    if (out.interchange.status !== "unrepresentable") return;
    expect(out.interchange.reason).toEqual({
      kind: "EVENT_CLIFF",
      eventId: "acquisition",
    });
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

  // An event-anchored cliff still maps to EVENT_CLIFF (the stacked commit's
  // derivation), even firing-blind where the cliff event never reads as fired.
  it("an event cliff stays EVENT_CLIFF", () => {
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

    expect(out.interchange.status).toBe("unrepresentable");
    if (out.interchange.status !== "unrepresentable") return;
    expect(out.interchange.reason).toEqual({
      kind: "EVENT_CLIFF",
      eventId: "ipo",
    });
  });

  // An event cliff behind a *pending* start. The whole schedule waits on the start
  // event, so firing-blind it's unresolved — but the storable cause is still the
  // event cliff (no schema home), not a cliff merely waiting on a firing. The
  // record keeper acts on the same fact whether the start has resolved or not, so
  // the reason must not flip to DEFERRED_CLIFF just because the start is pending.
  it("an event cliff behind a pending event start is EVENT_CLIFF, not DEFERRED_CLIFF", () => {
    const out = evaluateStatement(
      stmt(portion(1, 1), makeSingletonNode(makeVestingBaseEvent("ipo")), {
        type: "MONTHS",
        length: 1,
        occurrences: 48,
        cliff: makeSingletonNode(makeVestingBaseEvent("acquisition")),
      }),
      ctxInput(),
    );

    expect(out.interchange.status).toBe("unrepresentable");
    if (out.interchange.status !== "unrepresentable") return;
    expect(out.interchange.reason).toEqual({
      kind: "EVENT_CLIFF",
      eventId: "acquisition",
    });
  });

  // Start-invariance: the same event cliff with a resolved DATE start gets the
  // identical reason. The pending-ness of the start can't change what the schema
  // can hold for the cliff.
  it("the event-cliff reason is the same behind a pending start as behind a date start", () => {
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

    expect(pendingStart).toEqual(dateStart);
    expect(pendingStart).toEqual({
      status: "unrepresentable",
      reason: { kind: "EVENT_CLIFF", eventId: "acquisition" },
    });
  });

  // The resolution side is untouched by the interchange reason change: the pending
  // start still holds the whole grid as one undated lump, blocked only on the start
  // event (`ipo`). The event cliff contributes no blocker of its own here — the
  // start gates everything before the cliff can matter, so there's no spurious
  // `acquisition` blocker.
  it("a pending start with an event cliff resolves unchanged — one lump, only the start's blocker", () => {
    const out = evaluateStatement(
      stmt(portion(1, 1), makeSingletonNode(makeVestingBaseEvent("ipo")), {
        type: "MONTHS",
        length: 1,
        occurrences: 48,
        cliff: makeSingletonNode(makeVestingBaseEvent("acquisition")),
      }),
      ctxInput(),
    );

    expect(out.resolution.status).toBe("unresolved");
    if (out.resolution.status !== "unresolved") return;
    expect(out.resolution.pending).toEqual([
      { type: "EVENT_NOT_YET_OCCURRED", event: "ipo" },
    ]);
    expect(out.resolution.dead).toHaveLength(0);
    expect(out.resolution.installments).toHaveLength(1);
    expect(out.resolution.installments[0].state).toBe("UNRESOLVED");
  });

  // A gated event cliff behind a pending start. The gate decides whether the cliff
  // *stands* (a violated gate kills it), but a pending gate doesn't change what
  // the cliff is anchored to — an event cliff has no schema home whether gated or
  // not, so the storable reason names the permanent cause, not the temporary one.
  it("a gated event cliff behind a pending start is EVENT_CLIFF — the gate doesn't erase the event identity", () => {
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

    expect(out.interchange.status).toBe("unrepresentable");
    if (out.interchange.status !== "unrepresentable") return;
    expect(out.interchange.reason).toEqual({
      kind: "EVENT_CLIFF",
      eventId: "acquisition",
    });
  });

  // A gate can't change what the schema can hold: `CLIFF EVENT ipo AFTER DATE
  // 2026-01-01` has exactly as little a home as bare `CLIFF EVENT ipo`. Before
  // the fix the gated form read DEFERRED_CLIFF ("can't be stored ahead of
  // time") — implying the firing would make it storable, which it never does.
  it("a gated event cliff reports the same EVENT_CLIFF as the bare one", () => {
    const periodicityWith = (
      cliff: VestingNodeExpr<"VESTING_START">,
    ): VestingPeriod => ({
      type: "MONTHS",
      length: 1,
      occurrences: 48,
      cliff,
    });
    const gated = evaluateStatement(
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        periodicityWith(
          makeGatedNode(
            makeVestingBaseEvent("ipo"),
            "AFTER",
            makeSingletonNode(makeVestingBaseDate("2026-01-01")),
          ),
        ),
      ),
      ctxInput(),
    ).interchange;
    const bare = evaluateStatement(
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        periodicityWith(makeSingletonNode(makeVestingBaseEvent("ipo"))),
      ),
      ctxInput(),
    ).interchange;

    expect(gated).toEqual({
      status: "unrepresentable",
      reason: { kind: "EVENT_CLIFF", eventId: "ipo" },
    });
    expect(gated).toEqual(bare);
  });

  // Same property as the bare event cliff above: the gated one's storable
  // verdict must not move when the event fires and the gate clears.
  it("the gated-event-cliff interchange verdict is firing-invariant", () => {
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
    expect(unfired).toEqual({
      status: "unrepresentable",
      reason: { kind: "EVENT_CLIFF", eventId: "ipo" },
    });
  });

  // The fix is reason-only: the resolution surface for a pending start with a
  // gated event cliff keeps its one lump and its disclosed gate, exactly as
  // before. (Contrast the bare event cliff above, which contributes no blocker
  // of its own — a *gated* cliff's pending verdict rides through cliffBlockers
  // by the pinned gate-disclosure convention.)
  it("a pending start with a gated event cliff resolves unchanged — one lump, start blocker plus the gate's", () => {
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

    expect(out.resolution.status).toBe("unresolved");
    if (out.resolution.status !== "unresolved") return;
    expect(out.resolution.installments).toHaveLength(1);
    expect(out.resolution.installments[0].amount).toBe(100000);
    // All three are pending — nothing dead.
    expect(out.resolution.dead).toHaveLength(0);
    expect(out.resolution.pending.map((b) => b.type)).toEqual([
      "EVENT_NOT_YET_OCCURRED", // ipo (the start)
      "EVENT_NOT_YET_OCCURRED", // acquisition (the gated cliff's base)
      "UNRESOLVED_CONDITION", // the gate itself
    ]);
    expect(
      out.resolution.pending.flatMap((b) =>
        b.type === "EVENT_NOT_YET_OCCURRED" ? [b.event] : [],
      ),
    ).toEqual(["ipo", "acquisition"]);
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

  // The headline: the tail's event cliff is a permanent unstorability (no schema
  // home), which must win over the temporary "tail can't be dated yet".
  it("a bare event cliff on the tail reports EVENT_CLIFF, not EVENT_CHAINED_TAIL", () => {
    const out = evaluateProgram(
      chain({
        ...monthly12,
        cliff: makeSingletonNode(makeVestingBaseEvent("fda")),
      }),
      ctxInput(),
    );
    expect(out.interchange.status).toBe("unrepresentable");
    if (out.interchange.status !== "unrepresentable") return;
    expect(out.interchange.reason).toEqual({
      kind: "EVENT_CLIFF",
      eventId: "fda",
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

  // R2-B14: the gate routes the tail's event cliff to an UNRESOLVED record, but
  // the event identity rides along — the permanent cause (no schema home) still
  // beats both the gate's "can't be placed yet" and the tail's "can't be dated
  // yet".
  it("a gated event cliff on the tail reports EVENT_CLIFF (R2-B14)", () => {
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
    expect(out.interchange.status).toBe("unrepresentable");
    if (out.interchange.status !== "unrepresentable") return;
    expect(out.interchange.reason).toEqual({
      kind: "EVENT_CLIFF",
      eventId: "fda",
    });
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
