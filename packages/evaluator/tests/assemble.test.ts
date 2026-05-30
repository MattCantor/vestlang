// Phase 5a gate: the public evaluate path runs through resolve → classify →
// assemble → core, tagging each EvaluatedSchedule by interchange fidelity. These
// assert the three arms end-to-end, the exact-telescoping property for template
// schedules, and that the legacy engine is still reachable behind the flag.

import { describe, it, expect, afterEach } from "vitest";
import type {
  Amount,
  EvaluationContextInput,
  OCTDate,
  Program,
  VestingNode,
  VestingPeriod,
} from "@vestlang/types";
import {
  evaluateStatement,
  evaluateProgram,
  __useLegacyEngine,
} from "../src/evaluate/index";
import {
  makeSingletonSchedule,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
  makeDuration,
} from "./helpers";

const ctxInput = (
  overrides: Partial<EvaluationContextInput> = {},
): EvaluationContextInput => ({
  events: { grantDate: "2025-01-01" as OCTDate },
  grantQuantity: 100000,
  asOf: "2035-01-01" as OCTDate,
  ...overrides,
});

const portion = (numerator: number, denominator: number): Amount => ({
  type: "PORTION",
  numerator,
  denominator,
});

const stmt = (amount: Amount, start: VestingNode, periodicity: VestingPeriod) => ({
  amount,
  expr: makeSingletonSchedule(start, periodicity),
});

const sum = (xs: { amount: number }[]) => xs.reduce((a, x) => a + x.amount, 0);

afterEach(() => __useLegacyEngine(false));

describe("assemble — template fidelity", () => {
  const cliff12mo = makeSingletonNode(makeVestingBaseEvent("vestingStart"), [
    makeDuration(12, "MONTHS", "PLUS"),
  ]);
  const monthly48WithCliff = stmt(
    portion(1, 1),
    makeSingletonNode(makeVestingBaseDate("2025-01-01" as OCTDate)),
    { type: "MONTHS", length: 1, occurrences: 48, cliff: cliff12mo },
  );

  it("monthly-48 + 12mo cliff → RESOLVED installments tagged template", () => {
    const out = evaluateStatement(monthly48WithCliff, ctxInput());
    expect(out.fidelity).toBe("template");
    expect(out.blockers).toEqual([]);
    expect(out.installments).toHaveLength(37); // cliff lump + 36 monthly
    expect(out.installments.every((i) => i.meta.state === "RESOLVED")).toBe(true);
    expect(out.installments[0]).toMatchObject({
      date: "2026-01-01",
      amount: 25000,
    });
  });

  it("totals telescope EXACTLY to grant quantity", () => {
    const out = evaluateStatement(monthly48WithCliff, ctxInput());
    expect(sum(out.installments)).toBe(100000);
  });

  it("a graded multi-statement program collapses to ONE schedule", () => {
    const yearStmt = (num: number, from: OCTDate) =>
      stmt(portion(num, 20), makeSingletonNode(makeVestingBaseDate(from)), {
        type: "MONTHS",
        length: 12,
        occurrences: 1,
      });
    const program: Program = [
      yearStmt(1, "2025-01-01" as OCTDate),
      yearStmt(3, "2026-01-01" as OCTDate),
      yearStmt(8, "2027-01-01" as OCTDate),
      yearStmt(8, "2028-01-01" as OCTDate),
    ];
    const schedules = evaluateProgram(program, ctxInput());
    expect(schedules).toHaveLength(1); // whole program → one template schedule
    expect(schedules[0].fidelity).toBe("template");
    expect(sum(schedules[0].installments)).toBe(100000);
  });
});

describe("assemble — events-only fidelity", () => {
  it("two overlapping independent DATE grids → events-only + reason", () => {
    const program: Program = [
      stmt(portion(1, 2), makeSingletonNode(makeVestingBaseDate("2025-01-01" as OCTDate)), {
        type: "MONTHS",
        length: 12,
        occurrences: 1,
      }),
      stmt(portion(1, 2), makeSingletonNode(makeVestingBaseDate("2025-07-01" as OCTDate)), {
        type: "MONTHS",
        length: 12,
        occurrences: 1,
      }),
    ];
    const [out] = evaluateProgram(program, ctxInput());
    expect(out.fidelity).toBe("events-only");
    expect(out.reason).toBeTruthy();
    expect(out.installments.every((i) => i.meta.state === "RESOLVED")).toBe(true);
    expect(out.installments.map((i) => i.date)).toEqual([
      "2026-01-01",
      "2026-07-01",
    ]);
    expect(sum(out.installments)).toBe(100000);
  });

  it("a loaded allocation mode → events-only + reason, still telescopes", () => {
    const program: Program = [
      stmt(portion(1, 1), makeSingletonNode(makeVestingBaseDate("2025-01-01" as OCTDate)), {
        type: "MONTHS",
        length: 1,
        occurrences: 4,
      }),
    ];
    const [out] = evaluateProgram(
      program,
      ctxInput({ allocation_type: "FRONT_LOADED" }),
    );
    expect(out.fidelity).toBe("events-only");
    expect(out.reason).toMatch(/FRONT_LOADED/);
    expect(sum(out.installments)).toBe(100000);
  });
});

describe("assemble — unresolved fidelity", () => {
  it("unfired-event start → unresolved + blockers, symbolic installments", () => {
    const program: Program = [
      stmt(portion(1, 1), makeSingletonNode(makeVestingBaseEvent("ipo")), {
        type: "MONTHS",
        length: 0,
        occurrences: 1,
      }),
    ];
    const out = evaluateStatement(program[0], ctxInput()); // ipo not fired
    expect(out.fidelity).toBe("unresolved");
    expect(out.blockers.some((b) => b.type === "EVENT_NOT_YET_OCCURRED")).toBe(true);
    expect(out.installments.length).toBeGreaterThan(0);
    expect(out.installments.every((i) => i.meta.state !== "RESOLVED")).toBe(true);
  });
});

describe("assemble — legacy engine reachable behind the flag", () => {
  it("__useLegacyEngine(true) returns the legacy (untagged) schedule", () => {
    const s = stmt(
      portion(1, 1),
      makeSingletonNode(makeVestingBaseDate("2025-01-01" as OCTDate)),
      { type: "MONTHS", length: 1, occurrences: 12 },
    );
    __useLegacyEngine(true);
    const legacy = evaluateStatement(s, ctxInput());
    expect(legacy.fidelity).toBeUndefined(); // legacy doesn't tag fidelity
    expect(legacy.installments.length).toBeGreaterThan(0);

    __useLegacyEngine(false);
    const fresh = evaluateStatement(s, ctxInput());
    expect(fresh.fidelity).toBe("template");
  });
});
