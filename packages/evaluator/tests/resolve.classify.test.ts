import { describe, it, expect } from "vitest";
import type {
  Amount,
  EvaluationContextInput,
  OCTDate,
  Program,
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
} from "./helpers";

// `EVENT <event> BEFORE DATE <deadline>` — void once the event fires after the
// deadline (no witness assignment can satisfy it).
const eventBeforeDate = (event: string, deadline: OCTDate): VestingNode => ({
  type: "SINGLETON",
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

const ctxInput = (
  events: Record<string, OCTDate> = {},
  grantQuantity = 100000,
): EvaluationContextInput => ({
  events: { grantDate: "2025-01-01", ...events },
  grantQuantity,
  asOf: "2035-01-01",
});

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
      type: "LATER_OF",
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
