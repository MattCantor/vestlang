// THEN chains: a head plus one or more tails, where each tail picks up the
// timeline exactly where the previous segment ended. A date-origin chain should
// classify to a single `template`, and its dates must match what core's compiler
// produces for the same schedule — that equivalence is what these tests pin.

import { describe, it, expect } from "vitest";
import { addPeriod, compile } from "@vestlang/core";
import type {
  Amount,
  EvaluationContextInput,
  OCTDate,
  Program,
  Statement,
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
  overrides: Partial<EvaluationContextInput> = {},
): EvaluationContextInput => ({
  events: { grantDate: "2025-01-01" },
  grantQuantity: 100000,
  asOf: "2035-01-01",
  ...overrides,
});

const portion = (numerator: number, denominator: number): Amount => ({
  type: "PORTION",
  numerator,
  denominator,
});

// A chain head (or any ordinary statement): it carries its own FROM date.
const head = (
  amount: Amount,
  from: OCTDate,
  periodicity: VestingPeriod,
): Statement => ({
  amount,
  expr: makeSingletonSchedule(
    makeSingletonNode(makeVestingBaseDate(from)),
    periodicity,
  ),
});

// A THEN tail: it has no start of its own (vesting_start is null); the resolver
// fills in the handoff date — the moment the previous segment ended.
const then = (amount: Amount, periodicity: VestingPeriod): Statement => ({
  chained: true,
  amount,
  expr: { type: "SINGLETON", vesting_start: null, periodicity },
});

const dates = (events: { date: OCTDate }[]) => events.map((e) => e.date);
const sum = (events: { amount: string }[]) =>
  events.reduce((a, e) => a + Number(e.amount), 0);

describe("resolveToCore — date-origin THEN chain → template", () => {
  // The headline: graded 5/15/40/40 written as a chain, with no hand-computed
  // offsets. One tranche per year; each year's tail starts where the last ended.
  const yearly = { type: "MONTHS", length: 12, occurrences: 1 } as const;
  const graded: Program = [
    head(portion(1, 20), "2025-01-01", yearly),
    then(portion(3, 20), yearly),
    then(portion(8, 20), yearly),
    then(portion(8, 20), yearly),
  ];

  it("lowers to ONE template with four chained DATE statements", () => {
    const result = resolveToCore(graded, ctxInput());
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.template.statements).toHaveLength(4);
    expect(
      result.template.statements.every((s) => s.vesting_base.type === "DATE"),
    ).toBe(true);
    expect(result.runtime.startDate).toBe("2025-01-01");
  });

  it("compiles to 5/15/40/40 on the yearly handoffs", () => {
    const result = resolveToCore(graded, ctxInput());
    if (result.kind !== "template") throw new Error("expected template");
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(events).toEqual([
      { date: "2026-01-01", amount: "5000" },
      { date: "2027-01-01", amount: "15000" },
      { date: "2028-01-01", amount: "40000" },
      { date: "2029-01-01", amount: "40000" },
    ]);
  });

  it("matches the hand-rolled-offset form exactly", () => {
    // Writing the same schedule the old way — four independent statements with
    // hand-computed FROM dates — must compile to the identical installments. The
    // chain just spares the author the arithmetic.
    const handRolled: Program = [
      head(portion(1, 20), "2025-01-01", yearly),
      head(portion(3, 20), "2026-01-01", yearly),
      head(portion(8, 20), "2027-01-01", yearly),
      head(portion(8, 20), "2028-01-01", yearly),
    ];
    const chained = resolveToCore(graded, ctxInput());
    const rolled = resolveToCore(handRolled, ctxInput());
    if (chained.kind !== "template" || rolled.kind !== "template")
      throw new Error("expected templates");
    expect(
      compile(chained.template, chained.totalShares, chained.runtime),
    ).toEqual(compile(rolled.template, rolled.totalShares, rolled.runtime));
  });
});

describe("resolveToCore — core-consistency tripwire (drift-free anchors)", () => {
  // A monthly chain across two years (12 + 12). On first-of-month anchors there's
  // no day-of-month clamping, so the split schedule must land on exactly the same
  // grid as one un-split 24-month schedule. If the pre-pass cursor disagreed with
  // core's, these dates would drift apart.
  const monthly = { type: "MONTHS", length: 1, occurrences: 12 } as const;
  const program: Program = [
    head(portion(1, 2), "2025-01-01", monthly),
    then(portion(1, 2), monthly),
  ];

  it("compiles to the same monthly grid a single schedule would", () => {
    const result = resolveToCore(program, ctxInput());
    if (result.kind !== "template") throw new Error("expected template");
    const events = compile(result.template, result.totalShares, result.runtime);
    const expected = Array.from({ length: 24 }, (_, i) =>
      addPeriod("2025-01-01", i + 1, "MONTHS"),
    );
    expect(dates(events)).toEqual(expected);
    expect(sum(events)).toBe(100000);
  });
});

describe("resolveToCore — month-end day-of-month (characterizes #34)", () => {
  // KNOWN DEFECT (#34): when a chain boundary lands on a short month, core
  // re-anchors the rest of the chain at the *clamped* date and the day-of-month
  // drifts. These two tests pin the CURRENT behavior under two policies; when #34
  // is fixed in core, update the expected dates here — they are not a regression.
  const janEnd: Program = [
    head(portion(1, 3), "2025-01-31", {
      type: "MONTHS",
      length: 1,
      occurrences: 1,
    }),
    then(portion(2, 3), { type: "MONTHS", length: 1, occurrences: 2 }),
  ];

  it("default policy: handoff clamps to Feb 28 and the chain stays on the 28th", () => {
    const result = resolveToCore(
      janEnd,
      ctxInput({
        vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
      }),
    );
    if (result.kind !== "template") throw new Error("expected template");
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(dates(events)).toEqual(["2025-02-28", "2025-03-28", "2025-04-28"]);
  });

  it("month-end policy: each tranche returns to the last day of its month", () => {
    const result = resolveToCore(
      janEnd,
      ctxInput({ vesting_day_of_month: "31_OR_LAST_DAY_OF_MONTH" }),
    );
    if (result.kind !== "template") throw new Error("expected template");
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(dates(events)).toEqual(["2025-02-28", "2025-03-31", "2025-04-30"]);
  });
});

describe("resolveToCore — a cliff on a tail measures from the handoff", () => {
  // Head vests one tranche at the first anniversary (2026-01-01); that's where
  // the tail begins. The tail carries a 12-month cliff, so its first year lumps
  // onto 2027-01-01 (handoff + 12mo) — NOT onto 2026-01-01, which is where a
  // cliff measured from the grant would have landed.
  // A vestingStart-relative duration cliff, built the same way the
  // single-statement cliff test does; for a tail, "vestingStart" is the handoff.
  const tailCliff = makeSingletonNode(makeVestingBaseEvent("vestingStart"), [
    makeDuration(12, "MONTHS", "PLUS"),
  ]);
  const program: Program = [
    head(portion(1, 5), "2025-01-01", {
      type: "MONTHS",
      length: 12,
      occurrences: 1,
    }),
    then(portion(4, 5), {
      type: "MONTHS",
      length: 1,
      occurrences: 24,
      cliff: tailCliff,
    }),
  ];

  it("lumps the tail's pre-cliff tranches onto handoff + 12 months", () => {
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    const events = compile(result.template, result.totalShares, result.runtime);
    // The cliff sits at the second anniversary.
    expect(dates(events)).toContain("2027-01-01");
    // Nothing vests between the handoff (2026-01-01) and the cliff: if the cliff
    // had measured from the grant it would have fallen on the handoff and the
    // tail's monthly tranches would fill 2026.
    const between = events.filter(
      (e) => e.date > "2026-01-01" && e.date < "2027-01-01",
    );
    expect(between).toHaveLength(0);
  });
});

describe("resolveToCore — a lump head chains with the tail coincident", () => {
  // An empty span (occurrences 1, length 0) is a lump: it vests entirely at its
  // start and advances the cursor by nothing, so the tail begins on the same day.
  const program: Program = [
    head(portion(1, 3), "2025-01-01", {
      type: "MONTHS",
      length: 0,
      occurrences: 1,
    }),
    then(portion(2, 3), { type: "MONTHS", length: 12, occurrences: 2 }),
  ];

  it("classifies to template with the lump and the tail's first year both at grant", () => {
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.template.statements).toHaveLength(2);
    expect(result.runtime.startDate).toBe("2025-01-01");
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(dates(events)).toEqual(["2025-01-01", "2026-01-01", "2027-01-01"]);
    expect(sum(events)).toBe(100000);
  });
});
