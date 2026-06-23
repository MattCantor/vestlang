import { describe, it, expect } from "vitest";
import { compile } from "@vestlang/core";
import { CONTINGENT_START_SENTINEL } from "@vestlang/primitives";
import type {
  Amount,
  Blocker,
  ResolutionContextInput,
  OCTDate,
  Program,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";
import {
  rehydrate,
  resolveInterchange,
  resolveToCore,
} from "../src/resolve/index";
import { disclosuresOf } from "../src/resolve/lower";
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
      percentage: "0.25",
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

describe("resolveToCore — EVENT-anchored portion (fired → a dated start)", () => {
  const program: Program = [
    stmt(portion(1, 1), makeSingletonNode(makeVestingBaseEvent("ipo")), {
      type: "MONTHS",
      length: 0,
      occurrences: 1,
    }),
  ];

  it("a fired event start lowers to a plain DATE template at the firing date", () => {
    // With ipo fired, resolution dates the start, so it's an ordinary dated
    // template — no event base (it no longer exists), no sidecar.
    const result = resolveToCore(program, ctxInput({ ipo: "2026-04-01" }));
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.template.statements[0].vesting_base).toEqual({
      type: "DATE",
    });
    expect(result.runtime.startDate).toBe("2026-04-01");
    expect(result.sourceMap).toEqual({});
  });

  it("round-trips through core.compile", () => {
    const result = resolveToCore(program, ctxInput({ ipo: "2026-04-01" }));
    if (result.kind !== "template") throw new Error("expected template");
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(events).toEqual([{ date: "2026-04-01", amount: "100000" }]);
  });
});

describe("resolveToCore — EVENT anchor with offsets (FROM EVENT ipo + 1 month)", () => {
  // Unfired, this is a contingent start: the offset rides in the `evt:start`
  // recipe. Fired, the resolved date already folds in the offset, so it's a plain
  // dated start. Either way the projection reproduces firing+offset.
  const program: Program = [
    stmt(
      portion(1, 1),
      makeSingletonNode(makeVestingBaseEvent("ipo"), [
        makeDuration(1, "MONTHS", "PLUS"),
      ]),
      { type: "MONTHS", length: 1, occurrences: 2 },
    ),
  ];

  it("unfired → contingent template (sentinel + evt:start), offset in the recipe", () => {
    const result = resolveToCore(
      program,
      ctxInput({ grantDate: "2024-01-01" }),
    );
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.template.statements[0].vesting_base).toEqual({
      type: "DATE",
    });
    expect(result.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(result.sourceMap["evt:start"].definition).toMatch(/ipo/);
    expect(result.sourceMap["evt:start"].definition).toMatch(/\+1 month/);
    expect(result.blockers).toContainEqual({
      type: "EVENT_NOT_YET_OCCURRED",
      event: "ipo",
    });
  });

  it("rehydrating the stored artifact with the true firing derives the offset date", () => {
    // The stored artifact is the firing-invariant interchange one (sentinel start),
    // the same thing persist would store. Rehydrate substitutes the re-derived
    // start (firing + offset) into a projection-only runtime.
    const stored = resolveInterchange(
      program,
      ctxInput({ grantDate: "2024-01-01" }),
    );
    if (stored.status !== "template") throw new Error("expected template");
    const { runtime, startToApply } = rehydrate(
      stored.template,
      stored.sourceMap,
      stored.runtime,
      {
        grantDate: "2024-01-01",
        events: { ipo: "2024-03-01" },
        grantQuantity: 100000,
      },
    );
    expect(startToApply).toEqual({ date: "2024-04-01" });
    expect(runtime.startDate).toBe("2024-04-01");
    const events = compile(stored.template, 100000, runtime);
    expect(events.map((e) => e.date)).toEqual(["2024-05-01", "2024-06-01"]);
  });

  it("fired → a plain dated start at firing + offset, no sidecar", () => {
    const result = resolveToCore(
      program,
      ctxInput({ grantDate: "2024-01-01", ipo: "2024-03-01" }),
    );
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.template.statements[0].vesting_base).toEqual({
      type: "DATE",
    });
    expect(result.runtime.startDate).toBe("2024-04-01");
    expect(result.sourceMap).toEqual({});
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

  it("the stored interchange template + rehydration reproduce the fired projection", () => {
    // `before` is the stored (firing-invariant) interchange artifact; `after` is
    // the live resolution once ipo fired. Rehydrating `before` against the firing
    // must reproduce `after`'s projection (the read-only artifact is never mutated;
    // the start substitution is projection-only).
    const before = resolveInterchange(
      program,
      ctxInput({ grantDate: "2024-01-01" }),
    );
    const after = resolveToCore(
      program,
      ctxInput({ grantDate: "2024-01-01", ipo: "2024-03-01" }),
    );
    if (before.status !== "template" || after.kind !== "template")
      throw new Error("expected templates");
    const { runtime } = rehydrate(
      before.template,
      before.sourceMap,
      before.runtime,
      {
        grantDate: "2024-01-01",
        events: { ipo: "2024-03-01" },
        grantQuantity: 100000,
      },
    );
    // The frozen template is the same statement shape on both sides; the rehydrated
    // (projection-only) runtime reproduces the live resolution's dated projection.
    expect(after.template.statements[0].period_type).toBe(
      before.template.statements[0].period_type,
    );
    expect(compile(before.template, 100000, runtime)).toEqual(
      compile(after.template, 100000, after.runtime),
    );
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
    // 25000/100000 = 1/4, stored as the exact Numeric "0.25".
    expect(result.template.statements[0].percentage).toBe("0.25");
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
    expect(result.template.statements[0].percentage).toBe("0");
    expect(result.findings).toEqual([]);
  });
});

describe("disclosuresOf — the shared committed-disclosure read (#368)", () => {
  const ipoBlocker: Blocker = {
    type: "EVENT_NOT_YET_OCCURRED",
    event: "ipo",
    through: "2024-06-01",
  };

  it("a COMMITTED start passes its disclosures straight through", () => {
    // The committed EARLIER_OF floor: a concrete date plus the pending sibling's
    // blocker the three arms must surface. No compiler in the loop — the accessor
    // is the unit under test.
    expect(
      disclosuresOf({
        state: "COMMITTED",
        date: "2024-06-01",
        base: { type: "DATE" },
        disclosures: [ipoBlocker],
      }),
    ).toEqual([ipoBlocker]);
  });

  it("a RESOLVED start has nothing to disclose → []", () => {
    expect(
      disclosuresOf({
        state: "RESOLVED",
        date: "2024-06-01",
        base: { type: "DATE" },
      }),
    ).toEqual([]);
  });

  it("a pending (PENDING_EVENT) start discloses nothing through this read → []", () => {
    expect(
      disclosuresOf({
        state: "PENDING_EVENT",
        eventId: "ipo",
        expr: makeSingletonNode(makeVestingBaseEvent("ipo")),
        blockers: [ipoBlocker],
      }),
    ).toEqual([]);
  });
});
