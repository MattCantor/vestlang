import { describe, it, expect } from "vitest";
import { compile } from "@vestlang/core";
import type {
  Amount,
  EvaluationContextInput,
  OCTDate,
  Program,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";
import { rehydrate, resolveToCore } from "../src/resolve/index";
import {
  makeSingletonSchedule,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
  makeDuration,
  makeVestingBaseVestingStart,
} from "./helpers";

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
  start: VestingNodeExpr<"GRANT_DATE">,
  periodicity: VestingPeriod,
) => ({
  type: "STATEMENT" as const,
  amount,
  expr: makeSingletonSchedule(start, periodicity),
});

const sum = (events: { amount: string }[]) =>
  events.reduce((a, e) => a + Number(e.amount), 0);

describe("resolveToCore — single-statement monthly-48 with a 12-month cliff", () => {
  const cliff12mo = makeSingletonNode(makeVestingBaseVestingStart(), [
    makeDuration(12, "MONTHS", "PLUS"),
  ]);
  const program: Program = [
    stmt(portion(1, 1), makeSingletonNode(makeVestingBaseDate("2025-01-01")), {
      type: "MONTHS",
      length: 1,
      occurrences: 48,
      cliff: cliff12mo,
    }),
  ];

  it("lowers to one DATE template with a time-based cliff", () => {
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.template.statements).toHaveLength(1);
    const s = result.template.statements[0];
    expect(s.vesting_base).toEqual({ type: "DATE" });
    expect(s.cliff).toEqual({
      length: 12,
      period_type: "MONTHS",
      percentage: { numerator: 1, denominator: 4 },
    });
    expect(result.runtime.startDate).toBe("2025-01-01");
  });

  it("round-trips through core.compile to the known installments", () => {
    const result = resolveToCore(program, ctxInput());
    if (result.kind !== "template") throw new Error("expected template");
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(events).toHaveLength(37);
    expect(events[0]).toEqual({ date: "2026-01-01", amount: "25000" });
    expect(sum(events)).toBe(100000);
  });
});

describe("resolveToCore — graded 5/15/40/40 chained over 4 years", () => {
  const yearStmt = (num: number, from: OCTDate) =>
    stmt(portion(num, 20), makeSingletonNode(makeVestingBaseDate(from)), {
      type: "MONTHS",
      length: 12,
      occurrences: 1,
    });
  const program: Program = [
    yearStmt(1, "2025-01-01"),
    yearStmt(3, "2026-01-01"),
    yearStmt(8, "2027-01-01"),
    yearStmt(8, "2028-01-01"),
  ];

  it("lowers to ONE template with four chained DATE statements (no fan-out)", () => {
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.template.statements).toHaveLength(4);
    expect(
      result.template.statements.every((s) => s.vesting_base.type === "DATE"),
    ).toBe(true);
    expect(result.runtime.startDate).toBe("2025-01-01");
  });

  it("round-trips through core.compile to 5/15/40/40", () => {
    const result = resolveToCore(program, ctxInput());
    if (result.kind !== "template") throw new Error("expected template");
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(events).toEqual([
      { date: "2026-01-01", amount: "5000" },
      { date: "2027-01-01", amount: "15000" },
      { date: "2028-01-01", amount: "40000" },
      { date: "2029-01-01", amount: "40000" },
    ]);
  });
});

describe("resolveToCore — EVENT-anchored portion", () => {
  const program: Program = [
    stmt(portion(1, 1), makeSingletonNode(makeVestingBaseEvent("ipo")), {
      type: "MONTHS",
      length: 0,
      occurrences: 1,
    }),
  ];

  it("lowers to a floating EVENT statement + firing", () => {
    const result = resolveToCore(program, ctxInput({ ipo: "2026-04-01" }));
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.template.statements[0].vesting_base).toEqual({
      type: "EVENT",
      event_id: "ipo",
    });
    expect(result.runtime.eventFirings).toEqual([
      { event_id: "ipo", date: "2026-04-01" },
    ]);
    expect(result.runtime.startDate).toBeUndefined();
  });

  it("round-trips through core.compile", () => {
    const result = resolveToCore(program, ctxInput({ ipo: "2026-04-01" }));
    if (result.kind !== "template") throw new Error("expected template");
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(events).toEqual([{ date: "2026-04-01", amount: "100000" }]);
  });
});

describe("resolveToCore — EVENT anchor with offsets (FROM EVENT ipo + 1 month)", () => {
  // A bare EVENT statement can't hold the offset: storing `ipo` and anchoring
  // the grid at its raw firing would land everything a month early, and storing
  // the shifted date as ipo's firing would falsify the record. So the anchor
  // externalizes as a synthetic event whose definition keeps the offset.
  const program: Program = [
    stmt(
      portion(1, 1),
      makeSingletonNode(makeVestingBaseEvent("ipo"), [
        makeDuration(1, "MONTHS", "PLUS"),
      ]),
      { type: "MONTHS", length: 1, occurrences: 2 },
    ),
  ];

  it("unfired → template anchored on a synthetic event, offset in the sourceMap", () => {
    const result = resolveToCore(
      program,
      ctxInput({ grantDate: "2024-01-01" }),
    );
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.template.statements[0].vesting_base).toEqual({
      type: "EVENT",
      event_id: "evt:1",
    });
    expect(result.sourceMap["evt:1"].definition).toMatch(/ipo/);
    expect(result.sourceMap["evt:1"].definition).toMatch(/\+1 month/);
    expect(result.runtime.eventFirings).toBeUndefined();
    expect(result.blockers).toContainEqual({
      type: "EVENT_NOT_YET_OCCURRED",
      event: "ipo",
    });
  });

  it("rehydrating the stored artifact with the true firing derives the offset date", () => {
    const stored = resolveToCore(
      program,
      ctxInput({ grantDate: "2024-01-01" }),
    );
    if (stored.kind !== "template") throw new Error("expected template");
    const { runtime } = rehydrate(
      stored.template,
      stored.sourceMap,
      stored.runtime,
      {
        grantDate: "2024-01-01",
        events: { ipo: "2024-03-01" },
        grantQuantity: 100000,
        asOf: "2035-01-01",
      },
    );
    expect(runtime.eventFirings).toEqual([
      { event_id: "evt:1", date: "2024-04-01" },
    ]);
    const events = compile(stored.template, stored.totalShares, runtime);
    expect(events.map((e) => e.date)).toEqual(["2024-05-01", "2024-06-01"]);
  });

  it("fired → the recorded firing is the synthetic event's, never a shifted ipo", () => {
    const result = resolveToCore(
      program,
      ctxInput({ grantDate: "2024-01-01", ipo: "2024-03-01" }),
    );
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.template.statements[0].vesting_base).toEqual({
      type: "EVENT",
      event_id: "evt:1",
    });
    // The one record is the synthetic event at its derived date — resolving its
    // definition against the true firing. Nothing asserts ipo fired 2024-04-01.
    expect(result.runtime.eventFirings).toEqual([
      { event_id: "evt:1", date: "2024-04-01" },
    ]);
  });

  it("fired projection lands at firing + offset", () => {
    const result = resolveToCore(
      program,
      ctxInput({ grantDate: "2024-01-01", ipo: "2024-03-01" }),
    );
    if (result.kind !== "template") throw new Error("expected template");
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(events.map((e) => e.date)).toEqual(["2024-05-01", "2024-06-01"]);
    expect(sum(events)).toBe(100000);
  });

  it("lowering after the firing equals lowering before it plus rehydration", () => {
    const before = resolveToCore(
      program,
      ctxInput({ grantDate: "2024-01-01" }),
    );
    const after = resolveToCore(
      program,
      ctxInput({ grantDate: "2024-01-01", ipo: "2024-03-01" }),
    );
    if (before.kind !== "template" || after.kind !== "template")
      throw new Error("expected templates");
    const { runtime } = rehydrate(
      before.template,
      before.sourceMap,
      before.runtime,
      {
        grantDate: "2024-01-01",
        events: { ipo: "2024-03-01" },
        grantQuantity: 100000,
        asOf: "2035-01-01",
      },
    );
    expect(after.template).toEqual(before.template);
    expect(after.sourceMap).toEqual(before.sourceMap);
    expect(after.runtime).toEqual(runtime);
  });
});

describe("resolveToCore — QUANTITY amount lowers to a portion of the grant", () => {
  it("QUANTITY 25000 of 100000 → percentage 1/4", () => {
    const program: Program = [
      stmt(
        { type: "QUANTITY", value: 25000 },
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        { type: "MONTHS", length: 1, occurrences: 1 },
      ),
    ];
    const result = resolveToCore(program, ctxInput());
    if (result.kind !== "template") throw new Error("expected template");
    expect(result.template.statements[0].percentage).toEqual({
      numerator: 1,
      denominator: 4,
    });
  });

  it("QUANTITY against a zero-share grant lowers to 0/1, not a degenerate 1/0", () => {
    // A zero-share grant is legal; a QUANTITY has nothing to claim, so it vests
    // nothing rather than crashing the validator or allocator (issue #61).
    const program: Program = [
      stmt(
        { type: "QUANTITY", value: 25000 },
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        { type: "MONTHS", length: 1, occurrences: 1 },
      ),
    ];
    const result = resolveToCore(program, ctxInput({}, 0));
    if (result.kind !== "template") throw new Error("expected template");
    expect(result.template.statements[0].percentage).toEqual({
      numerator: 0,
      denominator: 1,
    });
    expect(result.findings).toEqual([]);
  });
});
