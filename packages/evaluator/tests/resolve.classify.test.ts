import { describe, it, expect } from "vitest";
import { compile } from "@vestlang/core";
import { CONTINGENT_START_SENTINEL } from "@vestlang/primitives";
import type {
  Amount,
  Blocker,
  ResolutionContextInput,
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
import { classify } from "../src/resolve/classify";
import type { StmtResolution } from "../src/resolve/lower";
import { evaluateProgram } from "../src/evaluate";
import { evaluateProgramAsOf } from "../src/asof";
import { blockerToString } from "../src/interpret/blockerToString";
import {
  baseCtx,
  makeSingletonSchedule,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
  makeVestingBaseGrantDate,
  makeDuration,
  makeVestingBaseVestingStart,
} from "./helpers";

// `EVENT <event> BEFORE DATE <deadline>` — void once the event fires after the
// deadline (no witness assignment can satisfy it).
const eventBeforeDate = (
  event: string,
  deadline: OCTDate,
): VestingNode<"GRANT_DATE"> => ({
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

// `DATE x AFTER DATE y` with x earlier than y — statically void: both dates are
// fixed, so no witness assignment can ever satisfy it.
const dateAfterDate = (
  date: OCTDate,
  after: OCTDate,
): VestingNode<"GRANT_DATE"> => ({
  type: "NODE",
  base: makeVestingBaseDate(date),
  offsets: [],
  condition: {
    type: "ATOM",
    constraint: {
      type: "AFTER",
      base: makeSingletonNode(makeVestingBaseDate(after)),
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

const laterOfEvents = (
  a: string,
  b: string,
): VestingNodeExpr<"VESTING_START"> => ({
  type: "NODE_LATER_OF",
  items: [
    makeSingletonNode(makeVestingBaseEvent(a)),
    makeSingletonNode(makeVestingBaseEvent(b)),
  ],
});

const isResolved = (i: { state: string }): i is ResolvedInstallment =>
  i.state === "RESOLVED";

const ctxInput = (
  events: Record<string, OCTDate> = {},
  grantQuantity = 100000,
): ResolutionContextInput => {
  // Callers override the grant date by passing `grantDate` in this map.
  const { grantDate = "2025-01-01", ...rest } = events;
  return {
    grantDate,
    events: rest,
    grantQuantity,
  };
};

const portion = (numerator: number, denominator: number): Amount => ({
  type: "PORTION",
  numerator,
  denominator,
});

const stmt = (
  amount: Amount,
  start: VestingNodeExpr<"GRANT_DATE">,
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
    expect(result.installments.filter(isResolved).map((i) => i.date)).toEqual([
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
    expect(
      result.installments.every((i) => isResolved(i) && i.date >= "2025-01-01"),
    ).toBe(true);
    expect(sum(result.installments)).toBe(100000);
  });
});

describe("resolveToCore — atomic unfired EVENT → contingent template", () => {
  it("unfired atomic EVENT start → contingent template (sentinel + evt:start) + blocker", () => {
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
    // A DATE statement on the contingent-start sentinel; the recipe to re-derive the
    // real start lives under the reserved `evt:start` key.
    expect(result.template.statements).toHaveLength(1);
    expect(result.template.statements[0].vesting_base).toEqual({
      type: "DATE",
    });
    expect(result.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(result.sourceMap["evt:start"].definition).toContain("ipo");
    expect(result.runtime.eventFirings ?? []).toEqual([]);
    expect(
      result.blockers.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
  });
});

describe("resolveToCore — event-held cliff is now a template (#255)", () => {
  it("LATER_OF over unfired events → template, held (no projection)", () => {
    // A `CLIFF LATER OF(EVENT a, EVENT b)` now stores as a synthetic event_condition
    // rather than falling out as unresolved — the held grid projects nothing.
    const cliff: VestingNodeExpr<"VESTING_START"> = {
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
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    // The statement carries a synthetic event_condition; the whole grid is held.
    expect(result.template.statements[0].event_condition).toBeDefined();
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it("synthetic event_condition hold discloses on the real events, never the minted id", () => {
    // The cliff stores under a synthetic `evt:<n>` id, but the pending disclosure
    // must name the underlying real events (`a`, `b`) — leaking `evt:1` out to an
    // MCP/CLI consumer would be a fidelity regression. Both events unfired.
    const cliff: VestingNodeExpr<"VESTING_START"> = {
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
    const out = evaluateProgram(program, ctxInput());
    expect(out.resolution.status).toBe("template");
    // `blockerToString` recurses the whole blocker tree, so it renders any leaked
    // synthetic id too; asserting on the rendered text is the real guard.
    const rendered = out.resolution.pending.map(blockerToString).join(" | ");
    expect(rendered).toContain("EVENT a");
    expect(rendered).toContain("EVENT b");
    expect(rendered).not.toContain("evt:");
  });

  it("two statements with a byte-identical synthetic event side share one minted id", () => {
    // Dedup by rendered recipe: a head dated grid plus two THEN tails, each tail
    // carrying the same `CLIFF LATER OF(EVENT a, EVENT b)`. Both tails' event sides
    // render byte-identically, so they collapse onto ONE synthetic `evt:<n>` and
    // one sidecar entry rather than minting `evt:1` and `evt:2`.
    const eventCliff = (): VestingNodeExpr<"VESTING_START"> => ({
      type: "NODE_LATER_OF",
      items: [
        makeSingletonNode(makeVestingBaseEvent("a")),
        makeSingletonNode(makeVestingBaseEvent("b")),
      ],
    });
    const monthly12 = (cliff?: VestingNodeExpr<"VESTING_START">) => ({
      type: "MONTHS" as const,
      length: 1,
      occurrences: 12,
      ...(cliff ? { cliff } : {}),
    });
    const tail = (cliff: VestingNodeExpr<"VESTING_START">): Statement => ({
      type: "STATEMENT",
      chained: true,
      amount: portion(1, 3),
      expr: {
        type: "SCHEDULE",
        vesting_start: null,
        periodicity: monthly12(cliff),
      },
    });
    const program: Program = [
      stmt(
        portion(1, 3),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        monthly12(),
      ),
      tail(eventCliff()),
      tail(eventCliff()),
    ];
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;

    // Both tails reference the same minted id (the head carries none).
    const id1 = result.template.statements[1].event_condition?.event_id;
    const id2 = result.template.statements[2].event_condition?.event_id;
    expect(id1).toMatch(/^evt:\d+$/);
    expect(id2).toBe(id1);

    // Exactly one `evt:<n>` sidecar entry — the dedup collapsed the two byte-equal
    // recipes onto one.
    const syntheticKeys = Object.keys(result.sourceMap).filter((k) =>
      /^evt:\d+$/.test(k),
    );
    expect(syntheticKeys).toEqual([id1]);
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
    expect(result.installments.every((i) => i.state === "IMPOSSIBLE")).toBe(
      true,
    );
    expect(
      result.blockers.every((b) => b.type === "IMPOSSIBLE_CONDITION"),
    ).toBe(true);
  });

  it("LATER_OF start with a statically-dead arm → impossible, not unresolved", () => {
    // Arm 1 (Jan 1 AFTER Jun 1) is statically dead; arm 2 resolves to Mar 1.
    // LATER_OF is universal, so the dead arm sinks the whole start — it must not
    // masquerade as pending on a witness that will never arrive. (#60)
    const start: VestingNodeExpr<"GRANT_DATE"> = {
      type: "NODE_LATER_OF",
      items: [
        dateAfterDate("2025-01-01", "2025-06-01"),
        makeSingletonNode(makeVestingBaseDate("2025-03-01")),
      ],
    };
    const program: Program = [
      {
        type: "STATEMENT",
        amount: portion(1, 1),
        expr: {
          type: "SCHEDULE",
          vesting_start: start,
          periodicity: twoYearsAnnual,
        },
      },
    ];
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("impossible");
  });

  it("merely-pending statement (unfired event start + event cliff) → template, held", () => {
    // ipo start unfired + an event cliff: both halves store (a contingent start +
    // an event_condition), so this is a held template, not unresolved/impossible.
    const cliff: VestingNodeExpr<"VESTING_START"> = makeSingletonNode(
      makeVestingBaseEvent("c"),
    );
    const program: Program = [
      stmt(portion(1, 1), makeSingletonNode(makeVestingBaseEvent("ipo")), {
        ...twoYearsAnnual,
        cliff,
      }),
    ];
    const result = resolveToCore(program, ctxInput()); // ipo, c unfired
    expect(result.kind).toBe("template");
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
    expect(result.installments.some((i) => i.state === "IMPOSSIBLE")).toBe(
      true,
    );
  });

  it("[plain dated grid, independent dated grid + event-held cliff] → events (two origins)", () => {
    // Two independent same-start grids don't chain into one template — that's
    // OVERLAPPING_ABSOLUTE_STARTS, events-only — regardless of the second's now-
    // storable event_condition. (Pre-#255 the unfired event cliff poisoned this to
    // unresolved; now the cliff is a template, so the two-grid shape decides.)
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
          cliff: laterOfEvents("a", "b"),
        },
      ),
    ];
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("events");
  });

  it("a single dated statement with an unfired event-held cliff → template, held to nothing", () => {
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
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    // The whole grid is held (synthetic event_condition, unfired), so compiling
    // the template releases nothing.
    expect(result.template.statements[0].event_condition).toBeDefined();
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(events).toEqual([]);
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
  ): ResolutionContextInput => ({
    grantDate: "2024-01-01",
    events: { ...events },
    grantQuantity: 48000,
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
      type: "DATE",
    });
    expect(result.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(result.sourceMap["evt:start"].definition).toContain("ipo");
    expect(result.template.statements[0].cliff).toEqual({
      length: 12,
      period_type: "MONTHS",
      percentage: "0.25",
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
    // 1-year cliff lump on start + 1yr (firing + 12 months), then 36 monthly
    // installments.
    expect(events).toHaveLength(37);
    expect(events[0]).toEqual({ date: "2026-06-01", amount: "12000" });
    expect(events.reduce((a, e) => a + Number(e.amount), 0)).toBe(48000);
  });

  it("unfired LATER_OF(+12mo, EVENT ipo) start carries the cliff as a pending template", () => {
    const start: VestingNodeExpr<"GRANT_DATE"> = {
      type: "NODE_LATER_OF",
      items: [
        makeSingletonNode(makeVestingBaseGrantDate(), [
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
    expect(result.template.statements[0].vesting_base).toEqual({
      type: "DATE",
    });
    expect(result.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(result.template.statements[0].cliff).toEqual({
      length: 12,
      period_type: "MONTHS",
      percentage: "0.25",
    });
    // The combinator gate is externalized as the one reserved evt:start recipe.
    expect(Object.keys(result.sourceMap)).toEqual(["evt:start"]);
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it("an event cliff on a pending start → compound template (contingent start + event_condition)", () => {
    // FROM EVENT ipo ... CLIFF EVENT board: both halves store — a contingent start
    // (sentinel + evt:start recipe) and the cliff's event_condition (#255 AC 11).
    const program: Program = [
      stmt(fullGrant, makeSingletonNode(makeVestingBaseEvent("ipo")), {
        ...monthly48,
        cliff: makeSingletonNode(makeVestingBaseEvent("board")),
      }),
    ];
    const result = resolveToCore(program, ctx21());
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(result.sourceMap["evt:start"].definition).toContain("ipo");
    expect(result.template.statements[0].event_condition).toEqual({
      event_id: "board",
    });
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

describe("resolveToCore — an event-held cliff stores as a template, held until fired (#138/#255)", () => {
  // 4,800 shares, monthly over 4 years, held by `CLIFF EVENT ipo`. The start is a
  // plain date, so the grid is fully placeable — but until ipo fires the
  // event_condition holds every installment. Under #255 this is a TEMPLATE
  // (event_condition: ipo), not unresolved/events.
  const eventCliff48: VestingPeriod = {
    type: "MONTHS",
    length: 1,
    occurrences: 48,
    cliff: makeSingletonNode(makeVestingBaseEvent("ipo")),
  };
  const program: Program = [
    stmt(
      portion(1, 1),
      makeSingletonNode(makeVestingBaseDate("2025-01-01")),
      eventCliff48,
    ),
  ];

  it("unfired → template, the whole grid held (projects nothing), with the event blocker", () => {
    const result = resolveToCore(program, ctxInput({}, 4800));
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    // The statement stores a bare event_condition on ipo and no time cliff.
    expect(result.template.statements[0].event_condition).toEqual({
      event_id: "ipo",
    });
    expect(result.template.statements[0].cliff).toBeUndefined();
    // Held: compiling the template against the firing-free interchange runtime
    // releases nothing (AC 5/7).
    const compiled = compile(
      result.template,
      result.totalShares,
      result.runtime,
    );
    expect(compiled).toEqual([]);
    expect(result.blockers).toEqual([
      { type: "EVENT_NOT_YET_OCCURRED", event: "ipo" },
    ]);
  });

  it("fired → template; the projection folds the proportional holdback lump", () => {
    const result = resolveToCore(
      program,
      ctxInput({ ipo: "2026-06-01" }, 4800),
    );
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    // The resolution-mode runtime carries the condition firing.
    expect(result.runtime.eventFirings).toEqual([
      { event_id: "ipo", date: "2026-06-01" },
    ]);
    // 17 monthly tranches fall at or before the firing → one 1,700-share lump on
    // the firing date, then 100/month. Compiling against the firing-carrying
    // runtime reproduces today's fired-event lump.
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(events[0]).toEqual({ date: "2026-06-01", amount: "1700" });
    expect(events).toHaveLength(32);
    expect(events.reduce((a, e) => a + Number(e.amount), 0)).toBe(4800);
  });

  it("a THEN tail's unfired event cliff holds the tail back, not the head → one template", () => {
    // The head is a plain dated grid; the tail chains off it (dated) and carries
    // an event_condition. Both are DATE-anchored off one start, so this is ONE
    // template — the head vests, the tail's grid is held until ipo fires.
    const monthly12 = (cliff?: VestingNodeExpr<"VESTING_START">) => ({
      type: "MONTHS" as const,
      length: 1,
      occurrences: 12,
      ...(cliff ? { cliff } : {}),
    });
    const chained: Program = [
      stmt(
        portion(1, 2),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        monthly12(),
      ),
      {
        type: "STATEMENT",
        chained: true,
        amount: portion(1, 2),
        expr: {
          type: "SCHEDULE",
          vesting_start: null,
          periodicity: monthly12(
            makeSingletonNode(makeVestingBaseEvent("ipo")),
          ),
        },
      },
    ];
    const result = resolveToCore(chained, ctxInput({}, 2400));
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    // The tail statement carries the event_condition; the head does not.
    expect(result.template.statements[0].event_condition).toBeUndefined();
    expect(result.template.statements[1].event_condition).toEqual({
      event_id: "ipo",
    });
    // The head vests its 1,200; the tail's 1,200 is held (not in the projection).
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(events.reduce((a, e) => a + Number(e.amount), 0)).toBe(1200);
    expect(
      result.blockers.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
  });
});

// The event-cliff (proportional) path sizes its lump from whatever the grid
// accrued by the firing. At the late edge — the firing past every installment —
// that's the whole grant in one lump, a real cliff. At the early edge — the
// firing before the first installment accrues — there's nothing to fold, so the
// lump is empty: the cliff drops away and the grid vests as a plain template, no
// lump and no reported cliff date.
describe("resolveToCore — event cliff at the grid edges (proportional)", () => {
  const eventCliff48: VestingPeriod = {
    type: "MONTHS",
    length: 1,
    occurrences: 48,
    cliff: makeSingletonNode(makeVestingBaseEvent("ipo")),
  };
  const program: Program = [
    stmt(
      portion(1, 1),
      makeSingletonNode(makeVestingBaseDate("2025-01-01")),
      eventCliff48,
    ),
  ];

  it("fired after the last installment → one full-grant lump on the firing", () => {
    // The grid ends 2029-01-01; ipo fires a year later. Every installment sits at
    // or before the firing, so the whole grant folds into one lump there. Now a
    // template — compile against the firing-carrying runtime.
    const result = resolveToCore(
      program,
      ctxInput({ ipo: "2030-01-01" }, 4800),
    );
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(events).toEqual([{ date: "2030-01-01", amount: "4800" }]);
  });

  it("fired before the vesting start → a plain even grid (the empty lump drops away)", () => {
    // ipo fires before 2025-01-01: nothing accrued by then, so the empty lump
    // drops and the grid vests evenly across its 48 months. The verdicts AGREE now
    // — both template (the event_condition is storable either way).
    const ctx = ctxInput({ ipo: "2024-06-01" }, 4800);
    const result = resolveToCore(program, ctx);
    expect(result.kind).toBe("template");

    const out = evaluateProgram(program, ctx);
    expect(out.resolution.status).toBe("template");
    // An event-held cliff is storable now — both verdicts read template.
    expect(out.interchange.status).toBe("template");

    if (result.kind !== "template") return;
    // The lump has no effect because nothing accrued by the firing, so the grid
    // still vests evenly (AC 15).
    const grid = compile(result.template, result.totalShares, result.runtime);
    expect(grid).toHaveLength(48);
    expect(grid[0]).toEqual({ date: "2025-02-01", amount: "100" });
    expect(grid.reduce((a, e) => a + Number(e.amount), 0)).toBe(4800);
  });
});

// A fired event cliff whose effective date lands before the first installment has
// nothing to fold into a lump, so it carries no projection effect. The resolution
// path must say so: a plain template, no cliff date — not an events split reported
// as if a real cliff sat on the firing. The interchange verdict is firing-blind,
// so it still can't store the event-anchored cliff: the two verdicts legitimately
// part ways here.
describe("resolveToCore — fired event cliff with no projection effect", () => {
  // VEST FROM DATE 2025-06-01 OVER 12 months EVERY 1 month CLIFF EVENT fda,
  // grant 120000 → a clean 12 × 10,000 grid starting 2025-07-01.
  const eventCliff12: VestingPeriod = {
    type: "MONTHS",
    length: 1,
    occurrences: 12,
    cliff: makeSingletonNode(makeVestingBaseEvent("fda")),
  };
  const program: Program = [
    stmt(
      portion(1, 1),
      makeSingletonNode(makeVestingBaseDate("2025-06-01")),
      eventCliff12,
    ),
  ];
  // Jul 2025 … Jun 2026, 10,000 each.
  const gridDates = [
    "2025-07-01",
    "2025-08-01",
    "2025-09-01",
    "2025-10-01",
    "2025-11-01",
    "2025-12-01",
    "2026-01-01",
    "2026-02-01",
    "2026-03-01",
    "2026-04-01",
    "2026-05-01",
    "2026-06-01",
  ];
  const evenGrid = gridDates.map((date) => ({
    state: "RESOLVED" as const,
    date,
    amount: 10000,
  }));

  // The grid vests evenly whether the firing sits before the start or after it but
  // ahead of the first installment — both are "nothing accrued yet", so both drop
  // the lump. Now a template (the event_condition is stored); compile reproduces
  // the even grid. The first installment lands 2025-07-01.
  it.each([
    ["before the start", "2025-02-01"],
    ["after the start, before the first installment", "2025-06-15"],
  ])(
    "fda fires %s → a template; the grid vests evenly (empty lump drops)",
    (_label, fda) => {
      const ctx = ctxInput({ fda }, 120000);
      const result = resolveToCore(program, ctx);
      expect(result.kind).toBe("template");

      const out = evaluateProgram(program, ctx);
      expect(out.resolution.status).toBe("template");
      // Both verdicts store the event hold now — they agree.
      expect(out.interchange.status).toBe("template");

      if (result.kind !== "template") return;
      const compiled = compile(
        result.template,
        result.totalShares,
        result.runtime,
      );
      expect(compiled).toEqual(
        evenGrid.map((e) => ({ date: e.date, amount: String(e.amount) })),
      );
    },
  );

  it("fda fires on the first installment → a real cliff (the lump stands)", () => {
    // The effective date equals the first grid date, so one installment (10,000)
    // accrues by then and folds into a lump there — a genuine cliff, stored as the
    // event_condition and reproduced by compile.
    const ctx = ctxInput({ fda: "2025-07-01" }, 120000);
    const result = resolveToCore(program, ctx);
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    const events = compile(result.template, result.totalShares, result.runtime);
    // The lump stands: 10,000 accrues by the firing and folds at 2025-07-01.
    expect(events[0]).toEqual({ date: "2025-07-01", amount: "10000" });
    expect(events.reduce((a, e) => a + Number(e.amount), 0)).toBe(120000);
  });

  it("unfired fda holds the whole grid back → template, projects nothing", () => {
    // An unfired event_condition holds every installment: the template projects
    // nothing (the grid is claimed but not released), with the event blocker.
    const result = resolveToCore(program, ctxInput({}, 120000));
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    const compiled = compile(
      result.template,
      result.totalShares,
      result.runtime,
    );
    expect(compiled).toEqual([]);
    expect(result.blockers).toEqual([
      { type: "EVENT_NOT_YET_OCCURRED", event: "fda" },
    ]);
  });
});

// The guard keys on the cliff's effective date (firing plus any offset on the
// cliff anchor), not the raw firing. A MINUS offset can drag a firing that's past
// the first installment back ahead of it — and then the cliff has nothing to fold
// and drops away; a PLUS offset can push an early firing onto a real installment —
// and then the cliff stands.
describe("resolveToCore — the no-effect guard keys on the effective date", () => {
  // 200 shares, monthly over 2 months from 2024-01-01 → installments Feb 1, Mar 1.
  const monthlyOffsetCliff = (sign: "PLUS" | "MINUS"): VestingPeriod => ({
    type: "MONTHS",
    length: 1,
    occurrences: 2,
    cliff: makeSingletonNode(makeVestingBaseEvent("ipo"), [
      makeDuration(1, "MONTHS", sign),
    ]),
  });

  it("MINUS offset drags the effective date before the first installment → empty lump drops", () => {
    // ipo fires 2024-02-10 (after the Feb 1 installment), but the −1 month offset
    // pulls the effective date to 2024-01-10, before any installment accrues. The
    // empty lump drops: a template whose grid vests evenly. The offset makes this a
    // synthetic event_condition.
    const program: Program = [
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseDate("2024-01-01")),
        monthlyOffsetCliff("MINUS"),
      ),
    ];
    const ctx = ctxInput({ grantDate: "2024-01-01", ipo: "2024-02-10" }, 200);
    const result = resolveToCore(program, ctx);
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    // Synthetic id (the offset can't ride on a bare id), with its recipe in the map.
    const ec = result.template.statements[0].event_condition;
    expect(ec?.event_id).toMatch(/^evt:\d+$/);
    const events = compile(result.template, result.totalShares, result.runtime);
    // Even grid: 100 on Feb 1, 100 on Mar 1.
    expect(events).toEqual([
      { date: "2024-02-01", amount: "100" },
      { date: "2024-03-01", amount: "100" },
    ]);

    const out = evaluateProgram(program, ctx);
    expect(out.interchange.status).toBe("template");
  });

  it("PLUS offset pushes the effective date onto an installment → a real cliff", () => {
    // ipo fires 2024-01-10 (before the Feb 1 installment), but the +1 month offset
    // pushes the effective date to 2024-02-10 — past the Feb 1 installment, which
    // accrues and folds into a lump. The cliff stands and reports its fold point.
    const program: Program = [
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseDate("2024-01-01")),
        monthlyOffsetCliff("PLUS"),
      ),
    ];
    const ctx = ctxInput({ grantDate: "2024-01-01", ipo: "2024-01-10" }, 200);
    const result = resolveToCore(program, ctx);
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(events.reduce((a, e) => a + Number(e.amount), 0)).toBe(200);
  });
});

describe("resolveToCore — event cliff with an offset (CLIFF EVENT ipo + 1 month)", () => {
  // 200 shares, monthly over 2 months from 2024-01-01. The cliff lands one month
  // after the firing, so with ipo on 2024-02-15 the lump belongs on 2024-03-15 —
  // reading the raw firing instead used to land it on 2024-02-15.
  const program: Program = [
    stmt(portion(1, 1), makeSingletonNode(makeVestingBaseDate("2024-01-01")), {
      type: "MONTHS",
      length: 1,
      occurrences: 2,
      cliff: makeSingletonNode(makeVestingBaseEvent("ipo"), [
        makeDuration(1, "MONTHS", "PLUS"),
      ]),
    }),
  ];

  it("fired → the lump lands at firing + offset, within one evaluation", () => {
    const result = resolveToCore(
      program,
      ctxInput({ grantDate: "2024-01-01", ipo: "2024-02-15" }, 200),
    );
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    // Both grid tranches (Feb 1, Mar 1) precede the effective cliff date
    // (firing + 1 month = 2024-03-15), so the whole grant folds into one lump there.
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(events).toEqual([{ date: "2024-03-15", amount: "200" }]);
  });

  it("unfired → the grid is still held back (template projects nothing), with the blocker", () => {
    const result = resolveToCore(
      program,
      ctxInput({ grantDate: "2024-01-01" }, 200),
    );
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(events).toEqual([]);
    // The blocker names the synthetic id (the offset externalized the event).
    expect(
      result.blockers.some((b) => b.type === "EVENT_NOT_YET_OCCURRED"),
    ).toBe(true);
  });
});

describe("resolveToCore — events arm carries its pending siblings (#148)", () => {
  // Two independent DATE grids force the events arm; the third portion floats on
  // an unfired event. Its 1,200 shares must not vanish from the collapsed
  // result: they ride along symbolically, and the verdict keeps the blocker.
  const monthly2: VestingPeriod = { type: "MONTHS", length: 1, occurrences: 2 };
  const program: Program = [
    stmt(
      portion(1, 2),
      makeSingletonNode(makeVestingBaseDate("2024-01-01")),
      monthly2,
    ),
    stmt(
      portion(1, 4),
      makeSingletonNode(makeVestingBaseDate("2024-06-15")),
      monthly2,
    ),
    stmt(
      portion(1, 4),
      makeSingletonNode(makeVestingBaseEvent("ipo")),
      monthly2,
    ),
  ];
  const ctx = ctxInput({ grantDate: "2024-01-01" }, 4800);

  it("pending portion's shares and blocker survive into the events verdict", () => {
    const result = resolveToCore(program, ctx);
    expect(result.kind).toBe("events");
    if (result.kind !== "events") return;
    // Two dated grids plus a contingent event start = more than one start origin.
    expect(result.reason.kind).toBe("MULTIPLE_START_ORIGINS");
    expect(result.blockers).toEqual([
      { type: "EVENT_NOT_YET_OCCURRED", event: "ipo" },
    ]);

    const dated = result.installments.filter(isResolved);
    expect(dated.map((i) => ({ date: i.date, amount: i.amount }))).toEqual([
      { date: "2024-02-01", amount: 1200 },
      { date: "2024-03-01", amount: 1200 },
      { date: "2024-07-15", amount: 600 },
      { date: "2024-08-15", amount: 600 },
    ]);
    const symbolic = result.installments.filter(
      (i) => i.state === "UNRESOLVED",
    );
    expect(sum(symbolic)).toBe(1200);
    // Every share of the grant is accounted for somewhere in the stream.
    expect(sum(result.installments)).toBe(4800);
  });

  it("as-of partitioning tallies the pending portion as unresolved", () => {
    const result = evaluateProgramAsOf(program, {
      grantDate: "2024-01-01",
      events: {},
      grantQuantity: 4800,
      asOf: "2026-01-01",
    });
    expect(sum(result.vested)).toBe(3600);
    expect(result.unresolved).toBe(1200);
  });
});

describe("classify — the events arm surfaces a committed floor's disclosures (#368)", () => {
  // The events arm's COMMITTED branch is only reachable when a committed EARLIER_OF
  // floor rides in beside a sibling that forced events-only — the single headline
  // DSL resolves to `template`, never here. Drive `classify` with a hand-built
  // `events` build: a COMMITTED start carrying a pending sibling's disclosure, next
  // to a RESOLVED start on an independent grid (the thing that forced this arm). The
  // disclosure must reach the verdict's blockers.
  const ipoBlocker: Blocker = {
    type: "EVENT_NOT_YET_OCCURRED",
    event: "ipo",
    through: "2024-06-01",
  };

  const monthly2 = { type: "MONTHS" as const, length: 1, occurrences: 2 };
  const headHead = { role: "head" as const };

  const committed: StmtResolution = {
    percentage: { numerator: 1, denominator: 2 },
    periodicity: monthly2,
    start: {
      state: "COMMITTED",
      date: "2024-06-01",
      base: { type: "DATE" },
      disclosures: [ipoBlocker],
    },
    cliff: { state: "NONE" },
    chain: headHead,
  };

  const resolvedSibling: StmtResolution = {
    percentage: { numerator: 1, denominator: 2 },
    periodicity: monthly2,
    start: { state: "RESOLVED", date: "2024-01-01", base: { type: "DATE" } },
    cliff: { state: "NONE" },
    chain: headHead,
  };

  it("the committed start's disclosure reaches the events verdict's blockers", () => {
    const verdict = classify({
      ok: false,
      why: "events",
      reason: { kind: "OVERLAPPING_ABSOLUTE_STARTS" },
      resolutions: [committed, resolvedSibling],
      ctx: baseCtx({ grantDate: "2024-01-01", grantQuantity: 4800 }),
    });
    expect(verdict.kind).toBe("events");
    expect(verdict.blockers).toContainEqual(ipoBlocker);
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

// AC 6 — the fired fold reproduces today's EVENT_FIRED lump for
// CLIFF LATER OF(12 months, EVENT ipo) on a 1-month/48 grid, 4,800 shares.
describe("resolveToCore — AC 6: LATER OF(12 months, EVENT ipo) fold point", () => {
  const program: Program = [
    stmt(portion(1, 1), makeSingletonNode(makeVestingBaseDate("2025-01-01")), {
      type: "MONTHS",
      length: 1,
      occurrences: 48,
      cliff: {
        type: "NODE_LATER_OF",
        items: [
          makeSingletonNode(makeVestingBaseVestingStart(), [
            makeDuration(12, "MONTHS", "PLUS"),
          ]),
          makeSingletonNode(makeVestingBaseEvent("ipo")),
        ],
      },
    }),
  ];

  // The DISCRIMINATING witness: ipo @ month 30 → 3,000 lump @ month 30, then
  // 100/mo × 18. Only the event path yields this — a plain 12-month cliff can't.
  it("ipo @ month 30 → 3,000 @ month 30, then 100/mo × 18", () => {
    const result = resolveToCore(
      program,
      ctxInput({ ipo: "2027-07-01" }, 4800), // month 30 from 2025-01-01
    );
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    const events = compile(result.template, result.totalShares, result.runtime);
    // The lump folds at max(12mo=2026-01-01, ipo=2027-07-01) = the firing.
    expect(events[0]).toEqual({ date: "2027-07-01", amount: "3000" });
    expect(events).toHaveLength(19); // 1 lump + 18 monthly
    expect(events.reduce((a, e) => a + Number(e.amount), 0)).toBe(4800);
  });

  // The NON-DISCRIMINATING projection (ipo ≤ month 12 → 1,200 @ month 12) is
  // identical to a plain 12-month cliff, so this test ALSO asserts the lowered
  // statement carries event_condition AND cliff{length:12}, and the verdict is a
  // template with the ipo absence-assumption — otherwise it would pass even if
  // event_condition were ignored.
  it("ipo @ month 6 → 1,200 @ month 12; lowered shape carries event_condition + cliff", () => {
    const result = resolveToCore(
      program,
      ctxInput({ ipo: "2025-07-01" }, 4800), // month 6 — before the 12-month baseline
    );
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    // The discriminating assertion: the stored shape carries BOTH halves.
    const s = result.template.statements[0];
    expect(s.event_condition).toEqual({ event_id: "ipo" });
    expect(s.cliff).toEqual({
      length: 12,
      period_type: "MONTHS",
      percentage: "0.25",
    });
    const events = compile(result.template, result.totalShares, result.runtime);
    // The lump folds at max(12mo baseline, firing) = 2026-01-01 (the baseline wins).
    expect(events[0]).toEqual({ date: "2026-01-01", amount: "1200" });
    expect(events).toHaveLength(37); // 1 lump + 36 monthly
    expect(events.reduce((a, e) => a + Number(e.amount), 0)).toBe(4800);
  });
});
