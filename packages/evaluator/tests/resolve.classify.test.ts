import { describe, it, expect } from "vitest";
import { compile } from "@vestlang/core";
import type {
  Amount,
  EvaluationContextInput,
  Finding,
  OCTDate,
  Program,
  ResolvedInstallment,
  Statement,
  VestingNode,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";
import { resolveToCore } from "../src/resolve/index";
import {
  makeSingletonSchedule,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
  makeDuration,
  makeVestingBaseVestingStart,
} from "./helpers";

// `EVENT <event> BEFORE DATE <deadline>` — void once the event fires after the
// deadline (no witness assignment can satisfy it).
const eventBeforeDate = (event: string, deadline: OCTDate): VestingNode => ({
  type: "NODE",
  base: makeVestingBaseEvent(event),
  offsets: [],
  condition: {
    type: "ATOM",
    constraint: {
      type: "BEFORE",
      base: makeSingletonNode(makeVestingBaseDate(deadline)),
      strict: false,
    },
  },
});

const twoYearsAnnual: VestingPeriod = {
  type: "MONTHS",
  length: 12,
  occurrences: 2,
};

const fourYearsAnnual: VestingPeriod = {
  type: "MONTHS",
  length: 12,
  occurrences: 4,
};

const laterOfEvents = (a: string, b: string): VestingNodeExpr => ({
  type: "NODE_LATER_OF",
  items: [
    makeSingletonNode(makeVestingBaseEvent(a)),
    makeSingletonNode(makeVestingBaseEvent(b)),
  ],
});

const isResolved = (i: { meta: { state: string } }): i is ResolvedInstallment =>
  i.meta.state === "RESOLVED";

const ctxInput = (
  events: Record<string, OCTDate> = {},
  grantQuantity = 100000,
): EvaluationContextInput => {
  // Callers override the grant date by passing `grantDate` in this map.
  const { grantDate = "2025-01-01", ...rest } = events;
  return {
    grantDate,
    events: rest,
    grantQuantity,
    asOf: "2035-01-01",
  };
};

const portion = (numerator: number, denominator: number): Amount => ({
  type: "PORTION",
  numerator,
  denominator,
});

const stmt = (
  amount: Amount,
  start: VestingNode,
  periodicity: VestingPeriod,
) => ({
  type: "STATEMENT" as const,
  amount,
  expr: makeSingletonSchedule(start, periodicity),
});

const sum = (xs: { amount: number }[]) => xs.reduce((a, x) => a + x.amount, 0);

describe("resolveToCore — events (resolves but doesn't fit one template)", () => {
  it("two overlapping independent DATE grids → events with reason", () => {
    // stmt1 ends 2026-01-01; stmt2 starts 2025-07-01 (doesn't chain) → not one template.
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
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("events");
    if (result.kind !== "events") return;
    expect(result.reason.kind).toBe("OVERLAPPING_ABSOLUTE_STARTS");
    expect(result.installments).toHaveLength(2);
    expect(result.installments.map((i) => i.date)).toEqual([
      "2026-01-01",
      "2026-07-01",
    ]);
    expect(sum(result.installments)).toBe(100000);
  });

  it("back-dated overlapping grids → events-only, pre-grant tranches fold onto grant date", () => {
    // Both grids start before grantDate 2025-01-01; their tranches must aggregate
    // onto the grant date (the implicit cliff), not surface pre-grant.
    const program: Program = [
      stmt(
        portion(1, 2),
        makeSingletonNode(makeVestingBaseDate("2023-01-01")),
        {
          type: "MONTHS",
          length: 12,
          occurrences: 1,
        },
      ),
      stmt(
        portion(1, 2),
        makeSingletonNode(makeVestingBaseDate("2023-07-01")),
        {
          type: "MONTHS",
          length: 12,
          occurrences: 1,
        },
      ),
    ];
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("events");
    if (result.kind !== "events") return;
    expect(result.installments.every((i) => i.date >= "2025-01-01")).toBe(true);
    expect(sum(result.installments)).toBe(100000);
  });
});

describe("resolveToCore — atomic unfired EVENT → template", () => {
  it("unfired atomic EVENT start → template (no firing) + EVENT_NOT_YET_OCCURRED blocker", () => {
    const program: Program = [
      stmt(portion(1, 1), makeSingletonNode(makeVestingBaseEvent("ipo")), {
        type: "MONTHS",
        length: 0,
        occurrences: 1,
      }),
    ];
    const result = resolveToCore(program, ctxInput()); // ipo not fired
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    // EVENT statement lowered with its event_id; runtime has no witness for it.
    expect(result.template.statements).toHaveLength(1);
    expect(result.template.statements[0].vesting_base).toEqual({
      type: "EVENT",
      event_id: "ipo",
    });
    expect(result.runtime.eventFirings ?? []).toEqual([]);
    expect(
      result.blockers.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
  });
});

describe("resolveToCore — unresolved (can't materialize yet)", () => {
  it("unresolved cliff (LATER_OF over unfired events) → unresolved with blockers", () => {
    const cliff: VestingNodeExpr = {
      type: "NODE_LATER_OF",
      items: [
        makeSingletonNode(makeVestingBaseEvent("a")),
        makeSingletonNode(makeVestingBaseEvent("b")),
      ],
    };
    const program: Program = [
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        {
          type: "MONTHS",
          length: 1,
          occurrences: 48,
          cliff,
        },
      ),
    ];
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("unresolved");
    if (result.kind !== "unresolved") return;
    expect(result.blockers.length).toBeGreaterThan(0);
  });
});

describe("resolveToCore — impossible (lossless rollup of all-void)", () => {
  it("single contradictory statement → impossible (all installments IMPOSSIBLE)", () => {
    // a fires 2025-06-01, after the BEFORE 2025-01-01 deadline → can never satisfy.
    const program: Program = [
      stmt(portion(1, 1), eventBeforeDate("a", "2025-01-01"), twoYearsAnnual),
    ];
    const result = resolveToCore(program, ctxInput({ a: "2025-06-01" }));
    expect(result.kind).toBe("impossible");
    if (result.kind !== "impossible") return;
    expect(result.installments.length).toBeGreaterThan(0);
    expect(
      result.installments.every((i) => i.meta.state === "IMPOSSIBLE"),
    ).toBe(true);
    expect(
      result.blockers.every((b) => b.type === "IMPOSSIBLE_CONDITION"),
    ).toBe(true);
  });

  it("merely-pending statement (unfired event) stays unresolved, not impossible", () => {
    // ipo unfired + an event cliff keeps it in the unresolved arm (satisfiable).
    const cliff: VestingNodeExpr = makeSingletonNode(makeVestingBaseEvent("c"));
    const program: Program = [
      stmt(portion(1, 1), makeSingletonNode(makeVestingBaseEvent("ipo")), {
        ...twoYearsAnnual,
        cliff,
      }),
    ];
    const result = resolveToCore(program, ctxInput()); // ipo, c unfired
    expect(result.kind).toBe("unresolved");
  });

  it("[void, pending] → unresolved (the pending half can still vest)", () => {
    const program: Program = [
      stmt(portion(1, 2), eventBeforeDate("a", "2025-01-01"), twoYearsAnnual),
      stmt(
        portion(1, 2),
        makeSingletonNode(makeVestingBaseEvent("ipo")),
        twoYearsAnnual,
      ),
    ];
    // a fired late (void); ipo unfired (pending).
    const result = resolveToCore(program, ctxInput({ a: "2025-06-01" }));
    expect(result.kind).toBe("unresolved");
  });

  it("[void, resolving] → unresolved (don't declare a vesting grant dead)", () => {
    const program: Program = [
      stmt(portion(1, 2), eventBeforeDate("a", "2025-01-01"), twoYearsAnnual),
      stmt(
        portion(1, 2),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        twoYearsAnnual,
      ),
    ];
    const result = resolveToCore(program, ctxInput({ a: "2025-06-01" }));
    expect(result.kind).toBe("unresolved");
  });

  it("all-void multi-statement program → impossible", () => {
    const program: Program = [
      stmt(portion(1, 2), eventBeforeDate("a", "2025-01-01"), twoYearsAnnual),
      stmt(portion(1, 2), eventBeforeDate("b", "2025-01-01"), twoYearsAnnual),
    ];
    const result = resolveToCore(
      program,
      ctxInput({ a: "2025-06-01", b: "2025-07-01" }),
    );
    expect(result.kind).toBe("impossible");
  });
});

describe("resolveToCore — unresolved arm surfaces resolved siblings (#28)", () => {
  it("[resolving, void] → unresolved, carrying the resolved half's dated tranches", () => {
    const program: Program = [
      stmt(
        portion(1, 2),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        twoYearsAnnual,
      ),
      stmt(portion(1, 2), eventBeforeDate("a", "2025-01-01"), twoYearsAnnual),
    ];
    const result = resolveToCore(program, ctxInput({ a: "2025-06-01" }));
    expect(result.kind).toBe("unresolved");
    if (result.kind !== "unresolved") return;
    const resolved = result.installments.filter(isResolved);
    expect(resolved.map((i) => i.date)).toEqual(["2026-01-01", "2027-01-01"]);
    expect(sum(resolved)).toBe(50000);
    // The void half is still reported at the leaf level.
    expect(result.installments.some((i) => i.meta.state === "IMPOSSIBLE")).toBe(
      true,
    );
  });

  it("[resolving, pending] → unresolved, resolved tranches alongside pending ones", () => {
    const program: Program = [
      stmt(
        portion(1, 2),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        twoYearsAnnual,
      ),
      stmt(
        portion(1, 2),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        {
          ...twoYearsAnnual,
          cliff: laterOfEvents("a", "b"), // unfired → the cliff stays unresolved
        },
      ),
    ];
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("unresolved");
    if (result.kind !== "unresolved") return;
    expect(sum(result.installments.filter(isResolved))).toBe(50000);
    expect(result.installments.some((i) => i.meta.state === "UNRESOLVED")).toBe(
      true,
    );
  });

  it("partially-resolved statement (resolved start, unresolved cliff) is not double-counted", () => {
    const program: Program = [
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        {
          ...twoYearsAnnual,
          cliff: laterOfEvents("a", "b"),
        },
      ),
    ];
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("unresolved");
    if (result.kind !== "unresolved") return;
    // No even-grid RESOLVED tranche leaks in alongside the symbolic cliff ones.
    expect(result.installments.every((i) => i.meta.state !== "RESOLVED")).toBe(
      true,
    );
    expect(result.installments).toHaveLength(2); // == occurrences, not doubled
  });

  it("back-dated resolved sibling folds pre-grant tranches onto the grant date", () => {
    const program: Program = [
      stmt(
        portion(1, 2),
        makeSingletonNode(makeVestingBaseDate("2023-01-01")),
        fourYearsAnnual,
      ),
      stmt(portion(1, 2), eventBeforeDate("a", "2025-01-01"), twoYearsAnnual),
    ];
    const result = resolveToCore(program, ctxInput({ a: "2025-06-01" }));
    expect(result.kind).toBe("unresolved");
    if (result.kind !== "unresolved") return;
    const resolved = result.installments.filter(isResolved);
    // The 2024-01-01 tranche (pre-grant) folds onto 2025-01-01: 12500 + 12500.
    expect(resolved.map((i) => ({ date: i.date, amount: i.amount }))).toEqual([
      { date: "2025-01-01", amount: 25000 },
      { date: "2026-01-01", amount: 12500 },
      { date: "2027-01-01", amount: 12500 },
    ]);
  });
});

describe("resolveToCore — pending event-anchored start + duration cliff (#21)", () => {
  // grant 2024-01-01, 48,000 shares: 4-year monthly grid, 1-year cliff.
  const cliff1yr = makeSingletonNode(makeVestingBaseVestingStart(), [
    makeDuration(12, "MONTHS", "PLUS"),
  ]);
  const monthly48: VestingPeriod = {
    type: "MONTHS",
    length: 1,
    occurrences: 48,
    cliff: cliff1yr,
  };
  const ctx21 = (
    events: Record<string, OCTDate> = {},
  ): EvaluationContextInput => ({
    grantDate: "2024-01-01",
    events: { ...events },
    grantQuantity: 48000,
    asOf: "2035-01-01",
  });
  const fullGrant = portion(1, 1);

  it("unfired atomic EVENT start carries the cliff as a pending template", () => {
    const program: Program = [
      stmt(
        fullGrant,
        makeSingletonNode(makeVestingBaseEvent("ipo")),
        monthly48,
      ),
    ];
    const result = resolveToCore(program, ctx21());
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.template.statements[0].vesting_base).toEqual({
      type: "EVENT",
      event_id: "ipo",
    });
    expect(result.template.statements[0].cliff).toEqual({
      length: 12,
      period_type: "MONTHS",
      percentage: { numerator: 1, denominator: 4 },
    });
    expect(result.runtime.eventFirings ?? []).toEqual([]);
    expect(
      result.blockers.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
  });

  it("firing the event yields the cliff lump then the monthly grid", () => {
    const program: Program = [
      stmt(
        fullGrant,
        makeSingletonNode(makeVestingBaseEvent("ipo")),
        monthly48,
      ),
    ];
    const result = resolveToCore(program, ctx21({ ipo: "2025-06-01" }));
    if (result.kind !== "template") throw new Error("expected template");
    const events = compile(result.template, result.totalShares, result.runtime);
    // 1-year cliff lump on start + 1yr, then 36 monthly installments.
    expect(events).toHaveLength(37);
    expect(events[0]).toEqual({ date: "2026-06-01", amount: "12000" });
    expect(events.reduce((a, e) => a + Number(e.amount), 0)).toBe(48000);
  });

  it("unfired LATER_OF(+12mo, EVENT ipo) start carries the cliff as a pending template", () => {
    const start: VestingNodeExpr = {
      type: "NODE_LATER_OF",
      items: [
        makeSingletonNode(makeVestingBaseVestingStart(), [
          makeDuration(12, "MONTHS", "PLUS"),
        ]),
        makeSingletonNode(makeVestingBaseEvent("ipo")),
      ],
    };
    const program: Program = [
      {
        type: "STATEMENT",
        amount: fullGrant,
        expr: {
          type: "SCHEDULE",
          vesting_start: start,
          periodicity: monthly48,
        },
      },
    ];
    const result = resolveToCore(program, ctx21());
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.template.statements[0].vesting_base.type).toBe("EVENT");
    expect(result.template.statements[0].cliff).toEqual({
      length: 12,
      period_type: "MONTHS",
      percentage: { numerator: 1, denominator: 4 },
    });
    // The combinator gate is externalized as one synthetic event.
    expect(Object.keys(result.sourceMap)).toHaveLength(1);
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it("an event cliff on a pending start still bails to unresolved", () => {
    const program: Program = [
      stmt(fullGrant, makeSingletonNode(makeVestingBaseEvent("ipo")), {
        ...monthly48,
        cliff: makeSingletonNode(makeVestingBaseEvent("board")),
      }),
    ];
    expect(resolveToCore(program, ctx21()).kind).toBe("unresolved");
  });

  it("a cross-unit cliff (months over a days grid) still needs the anchor → unresolved", () => {
    const program: Program = [
      stmt(fullGrant, makeSingletonNode(makeVestingBaseEvent("ipo")), {
        type: "DAYS",
        length: 30,
        occurrences: 48,
        cliff: cliff1yr,
      }),
    ];
    expect(resolveToCore(program, ctx21()).kind).toBe("unresolved");
  });
});

describe("resolveToCore — template arm still wins when it fits", () => {
  it("a chained, resolvable program returns kind: template", () => {
    const program: Program = [
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        {
          type: "MONTHS",
          length: 1,
          occurrences: 12,
        },
      ),
    ];
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("template");
  });
});

// A grant can't vest more than itself. The check sums each statement's
// share-of-grant and flags anything over 100%, regardless of which verdict the
// program lands in — so both a single oversized statement (a template) and two
// statements that overlap past the grant (events) get caught.
describe("resolveToCore — over-allocation finding", () => {
  const yearly: VestingPeriod = { type: "MONTHS", length: 12, occurrences: 1 };

  const quantity = (value: number): Amount => ({ type: "QUANTITY", value });

  // A THEN tail: it carries its own share but inherits the handoff date.
  const then = (amount: Amount, periodicity: VestingPeriod): Statement => ({
    type: "STATEMENT",
    chained: true,
    amount,
    expr: { type: "SCHEDULE", vesting_start: null, periodicity },
  });

  const overAllocation = (result: { findings: Finding[] }) =>
    result.findings.filter((f) => f.kind === "over-allocation");

  it("two 3/4 grids on different dates (events) sum to 3/2 → one error finding", () => {
    const program: Program = [
      stmt(
        portion(3, 4),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        yearly,
      ),
      stmt(
        portion(3, 4),
        makeSingletonNode(makeVestingBaseDate("2025-06-01")),
        yearly,
      ),
    ];
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("events");
    expect(overAllocation(result)).toEqual([
      {
        kind: "over-allocation",
        severity: "error",
        sum: { numerator: 3, denominator: 2 },
        path: ["Program"],
      },
    ]);
  });

  it("a single 3/2 statement (template) carries the same finding", () => {
    const program: Program = [
      stmt(
        portion(3, 2),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        yearly,
      ),
    ];
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("template");
    expect(overAllocation(result)).toHaveLength(1);
    expect(overAllocation(result)[0].sum).toEqual({
      numerator: 3,
      denominator: 2,
    });
  });

  it("mixed QUANTITY statements over the grant are caught (the linter punts on these)", () => {
    // 750 + 750 = 1500 shares against a 1000-share grant → 3/2.
    const program: Program = [
      stmt(
        quantity(750),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        yearly,
      ),
      stmt(
        quantity(750),
        makeSingletonNode(makeVestingBaseDate("2025-06-01")),
        yearly,
      ),
    ];
    const result = resolveToCore(program, ctxInput({}, 1000));
    expect(overAllocation(result)).toHaveLength(1);
    expect(overAllocation(result)[0].sum).toEqual({
      numerator: 3,
      denominator: 2,
    });
  });

  it("a zero-share grant raises no finding — nothing can allocate against it", () => {
    // 3/2 would over-allocate against any real grant, but a zero-share grant can't
    // allocate at all, so the check is skipped rather than flagging it. (A QUANTITY
    // against zero shares is covered separately below — it lowers to 0, not a
    // degenerate fraction.)
    const program: Program = [
      stmt(
        portion(3, 2),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        yearly,
      ),
    ];
    expect(resolveToCore(program, ctxInput({}, 0)).findings).toEqual([]);
  });

  it("QUANTITY on a zero-share grant down the events path allocates nothing, no throw", () => {
    // Two QUANTITY grids on different dates classify to events; against a
    // zero-share grant each lowers to 0, so the allocator runs cleanly and emits
    // nothing rather than dividing by zero (issue #61, the events-path repro).
    const program: Program = [
      stmt(
        quantity(750),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        yearly,
      ),
      stmt(
        quantity(750),
        makeSingletonNode(makeVestingBaseDate("2025-06-01")),
        yearly,
      ),
    ];
    const result = resolveToCore(program, ctxInput({}, 0));
    expect(result.kind).toBe("events");
    if (result.kind !== "events") throw new Error("expected events");
    expect(result.installments).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("a THEN chain that over-allocates is caught on the tail's own share", () => {
    // head 3/4 then tail 3/4 → 3/2, one resolved template.
    const program: Program = [
      stmt(
        portion(3, 4),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        yearly,
      ),
      then(portion(3, 4), yearly),
    ];
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("template");
    expect(overAllocation(result)).toHaveLength(1);
  });

  it("an impossible program still flags over-allocation — it's a firing-invariant defect", () => {
    // 3/2 over-allocates regardless of whether the start can ever fire. The
    // declared share sum is independent of the impossibility verdict, so the
    // finding stands: a record keeper resolving against its own events would
    // still store an over-allocating spec.
    const program: Program = [
      stmt(portion(3, 2), eventBeforeDate("a", "2025-01-01"), twoYearsAnnual),
    ];
    const result = resolveToCore(program, ctxInput({ a: "2025-06-01" }));
    expect(result.kind).toBe("impossible");
    expect(result.findings).toEqual([
      {
        kind: "over-allocation",
        severity: "error",
        sum: { numerator: 3, denominator: 2 },
        path: ["Program"],
      },
    ]);
  });

  it("a well-formed full grant carries no finding", () => {
    const program: Program = [
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        yearly,
      ),
    ];
    expect(resolveToCore(program, ctxInput()).findings).toEqual([]);
  });
});

// Allocating less than the whole grant is legal — a grant may leave shares
// unvested — so it's a warning, not an error. It fires whenever the schedule sums
// to under 100%, on a lone statement or a composed one.
describe("resolveToCore — under-allocation finding", () => {
  const yearly: VestingPeriod = { type: "MONTHS", length: 12, occurrences: 1 };

  const underAllocation = (result: { findings: Finding[] }) =>
    result.findings.filter((f) => f.kind === "under-allocation");

  it("a single 1/2 statement warns (it is the entire schedule)", () => {
    const program: Program = [
      stmt(
        portion(1, 2),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        yearly,
      ),
    ];
    const result = resolveToCore(program, ctxInput());
    expect(underAllocation(result)).toEqual([
      {
        kind: "under-allocation",
        severity: "warning",
        sum: { numerator: 1, denominator: 2 },
        path: ["Program"],
      },
    ]);
  });

  it("two 1/4 statements summing to 1/2 warn the same way", () => {
    const program: Program = [
      stmt(
        portion(1, 4),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        yearly,
      ),
      stmt(
        portion(1, 4),
        makeSingletonNode(makeVestingBaseDate("2025-06-01")),
        yearly,
      ),
    ];
    const result = resolveToCore(program, ctxInput());
    expect(underAllocation(result)).toHaveLength(1);
    expect(underAllocation(result)[0].sum).toEqual({
      numerator: 1,
      denominator: 2,
    });
  });

  it("a bare statement defaults to the whole grant — no finding", () => {
    const program: Program = [
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        yearly,
      ),
    ];
    expect(resolveToCore(program, ctxInput()).findings).toEqual([]);
  });
});
