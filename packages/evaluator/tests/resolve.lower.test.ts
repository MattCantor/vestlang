import { describe, it, expect } from "vitest";
import { compile } from "@vestlang/core";
import type {
  Amount,
  EvaluationContextInput,
  OCTDate,
  Program,
  VestingNode,
  VestingPeriod,
} from "@vestlang/types";
import { resolveToCore } from "../src/resolve/index";
import {
  makeSingletonSchedule,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
  makeDuration,
} from "./helpers";

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
  type: "STATEMENT" as const,
  amount,
  expr: makeSingletonSchedule(start, periodicity),
});

const sum = (events: { amount: string }[]) =>
  events.reduce((a, e) => a + Number(e.amount), 0);

describe("resolveToCore — single-statement monthly-48 with a 12-month cliff", () => {
  const cliff12mo = makeSingletonNode(makeVestingBaseEvent("vestingStart"), [
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
});
