import { describe, it, expect } from "vitest";
import { compile } from "@vestlang/core";
import type {
  Amount,
  ResolutionContextInput,
  OCTDate,
  Program,
  ResolvedInstallment,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";
import { resolveToCore } from "../src/resolve/index";
import { lowerCliff } from "../src/resolve/cliff";
import {
  baseCtx,
  makeDuration,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
  makeVestingBaseVestingStart,
} from "./helpers";

// Frozen oracle for the share-allocation kernel (issue #85), evaluator-side cases.
//
// The compiler in @vestlang/core and this package's runtime resolver carry two
// hand-kept copies of the same grid-layout / cliff-partition / allocation math.
// A later refactor pulls that into one shared primitive and rewires both engines
// onto it. These tests pin current behaviour — especially the dates and share
// counts a cliff produces — so any drift introduced by the refactor fails loudly.
// Nothing here should change when the kernel is extracted.

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
  expr: { type: "SCHEDULE" as const, vesting_start: start, periodicity },
});

const ctxInput = (
  events: Record<string, OCTDate> = {},
  grantQuantity = 96000,
): ResolutionContextInput => {
  // Callers override the grant date by passing `grantDate` in this map.
  const { grantDate = "2025-01-01", ...rest } = events;
  return {
    grantDate,
    events: rest,
    grantQuantity,
  };
};

const sum = (xs: { amount: number }[]) => xs.reduce((a, x) => a + x.amount, 0);
const isResolved = (i: { state: string }): i is ResolvedInstallment =>
  i.state === "RESOLVED";

// A one-year cliff written as a duration off the vesting start.
const oneYearCliff: VestingNodeExpr<"VESTING_START"> = makeSingletonNode(
  makeVestingBaseVestingStart(),
  [makeDuration(12, "MONTHS", "PLUS")],
);

// A two-month cliff, likewise relative to the vesting start.
const twoMonthCliff: VestingNodeExpr<"VESTING_START"> = makeSingletonNode(
  makeVestingBaseVestingStart(),
  [makeDuration(2, "MONTHS", "PLUS")],
);

// A cliff waiting on the later of two events, neither of which has fired.
const laterOfUnfired: VestingNodeExpr<"VESTING_START"> = {
  type: "NODE_LATER_OF",
  items: [
    makeSingletonNode(makeVestingBaseEvent("a")),
    makeSingletonNode(makeVestingBaseEvent("b")),
  ],
};

describe("kernel oracle — the two engines agree on a shared schedule", () => {
  // The point of the whole refactor: a cliffed schedule that the resolver folds
  // into one template (and core then compiles) must produce the same tranches as
  // the SAME schedule sitting next to an unrelated sibling, which forces the
  // resolver down its events path instead. Same shares, same dates, either way.
  //
  // Half the grant on a four-year monthly grid with a one-year cliff. Sibling is
  // the other half on an independent start, landing on a day no grid tranche uses
  // so it's easy to set aside. Amounts are chosen to divide evenly, so flooring
  // never depends on the order events happen to interleave.
  const cliffed = stmt(
    portion(1, 2),
    makeSingletonNode(makeVestingBaseDate("2025-01-01")),
    { type: "MONTHS", length: 1, occurrences: 48, cliff: oneYearCliff },
  );
  const siblingDate = "2026-07-15";
  const sibling = stmt(
    portion(1, 2),
    makeSingletonNode(makeVestingBaseDate("2025-07-15")),
    { type: "MONTHS", length: 12, occurrences: 1 },
  );

  it("template path and events path yield identical cliffed tranches", () => {
    // Template path: the cliffed schedule alone.
    const asTemplate = resolveToCore([cliffed], ctxInput());
    if (asTemplate.kind !== "template") throw new Error("expected template");
    const fromTemplate = compile(
      asTemplate.template,
      asTemplate.totalShares,
      asTemplate.runtime,
    ).map((e) => ({ date: e.date, amount: Number(e.amount) }));

    // Events path: same schedule, plus the overlapping sibling.
    const asEvents = resolveToCore([cliffed, sibling], ctxInput());
    expect(asEvents.kind).toBe("events");
    if (asEvents.kind !== "events") return;
    const fromEvents = asEvents.installments
      .filter(isResolved)
      .filter((i) => i.date !== siblingDate)
      .map((i) => ({ date: i.date, amount: i.amount }));

    expect(fromEvents).toEqual(fromTemplate);
  });

  it("the boundary tranche — the cliff lump — matches in both", () => {
    const asTemplate = resolveToCore([cliffed], ctxInput());
    if (asTemplate.kind !== "template") throw new Error("expected template");
    const lump = compile(
      asTemplate.template,
      asTemplate.totalShares,
      asTemplate.runtime,
    )[0];
    expect(lump).toEqual({ date: "2026-01-01", amount: "12000" });

    const asEvents = resolveToCore([cliffed, sibling], ctxInput());
    if (asEvents.kind !== "events") throw new Error("expected events");
    const eventsLump = asEvents.installments
      .filter(isResolved)
      .find((i) => i.date === "2026-01-01");
    expect(eventsLump?.amount).toBe(12000);
  });
});

describe("kernel oracle — cliffs over the events path land on real month-ends", () => {
  // Two independent half-grant schedules, each with a two-month cliff, started on
  // a 31st so the monthly grid has to fall back to shorter month-ends (Feb 29 in
  // a leap year, Sep 30, Apr 30...). Because the starts overlap and don't chain,
  // the resolver materialises them straight to dated tranches.
  const program: Program = [
    stmt(portion(1, 2), makeSingletonNode(makeVestingBaseDate("2024-01-31")), {
      type: "MONTHS",
      length: 1,
      occurrences: 4,
      cliff: twoMonthCliff,
    }),
    stmt(portion(1, 2), makeSingletonNode(makeVestingBaseDate("2024-04-30")), {
      type: "MONTHS",
      length: 1,
      occurrences: 4,
      cliff: twoMonthCliff,
    }),
  ];

  it("lumps land on the clamped cliff dates, post-cliff stays on the grid", () => {
    // Grant date sits before the schedule so the tranches aren't folded onto it.
    const result = resolveToCore(
      program,
      ctxInput({ grantDate: "2024-01-01" }, 80000),
    );
    expect(result.kind).toBe("events");
    if (result.kind !== "events") return;
    expect(
      result.installments
        .filter(isResolved)
        .map((i) => ({ date: i.date, amount: i.amount })),
    ).toEqual([
      { date: "2024-03-31", amount: 20000 },
      { date: "2024-04-30", amount: 10000 },
      { date: "2024-05-31", amount: 10000 },
      { date: "2024-06-30", amount: 20000 },
      { date: "2024-07-30", amount: 10000 },
      { date: "2024-08-30", amount: 10000 },
    ]);
    expect(sum(result.installments)).toBe(80000);
  });
});

describe("kernel oracle — a cliff gated on an event that fires", () => {
  // The cliff here isn't a date offset — it's an event ("ipo"). The grant vests
  // monthly over four years, but nothing is released until the IPO happens, at
  // which point everything up to that date lumps together.
  const eventCliff: VestingNodeExpr<"VESTING_START"> = makeSingletonNode(
    makeVestingBaseEvent("ipo"),
  );
  const program: Program = [
    stmt(portion(1, 1), makeSingletonNode(makeVestingBaseDate("2025-01-01")), {
      type: "MONTHS",
      length: 1,
      occurrences: 48,
      cliff: eventCliff,
    }),
  ];

  it("IPO on a grid date lumps the first year, then resumes monthly", () => {
    // IPO lands exactly on the first anniversary — 12 of 48 months are behind it.
    // Now a template (event_condition: ipo); compile against the firing-carrying
    // runtime reproduces the same lump + grid.
    const result = resolveToCore(
      program,
      ctxInput({ ipo: "2026-01-01" }, 48000),
    );
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(events).toHaveLength(37);
    expect(events[0]).toEqual({ date: "2026-01-01", amount: "12000" });
    expect(events.reduce((a, e) => a + Number(e.amount), 0)).toBe(48000);
  });
});

describe("kernel oracle — an off-grid event cliff derives its own percentage", () => {
  // When an event cliff fires between two monthly grid points, the share that
  // lumps is whatever fraction of the grid sits at or before that date — here the
  // evaluator works out the percentage itself rather than being told one.
  const eventCliff: VestingNodeExpr<"VESTING_START"> = makeSingletonNode(
    makeVestingBaseEvent("ipo"),
  );
  const program: Program = [
    stmt(portion(1, 1), makeSingletonNode(makeVestingBaseDate("2025-01-01")), {
      type: "MONTHS",
      length: 1,
      occurrences: 48,
      cliff: eventCliff,
    }),
  ];

  it("15 of 48 months precede the firing → a 15/48 lump", () => {
    // IPO on 2026-04-15 sits just after the 15th monthly point (2026-04-01). Now a
    // template; compile reproduces the off-grid proportional lump.
    const result = resolveToCore(
      program,
      ctxInput({ ipo: "2026-04-15" }, 48000),
    );
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    const events = compile(result.template, result.totalShares, result.runtime);
    // 15/48 of 48000 = 15000.
    expect(events[0]).toEqual({ date: "2026-04-15", amount: "15000" });
    expect(events).toHaveLength(34); // 1 lump + 33 remaining months
    expect(events.reduce((a, e) => a + Number(e.amount), 0)).toBe(48000);
  });
});

describe("kernel oracle — the cliff lowering and the grid agree on the count", () => {
  // lowerCliff decides what fraction a cliff covers by counting grid points at or
  // before the cliff date; the compiler then partitions the very same grid. They
  // walk the same clamped month-ends, so they must reach the same count. Start on
  // a 31st, two-month cliff: Feb 29 and Mar 31 fall on or before it → 2 of 4.
  const anchor = "2024-01-31" as OCTDate;
  const cliffCtx = baseCtx({
    grantDate: "2024-01-01",
    events: {},
    vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
  });

  it("lowerCliff reports 2 of 4 (a half) on the clamped grid", () => {
    expect(lowerCliff(twoMonthCliff, anchor, "MONTHS", 1, 4, cliffCtx)).toEqual(
      {
        state: "RESOLVED",
        cliff: {
          length: 2,
          period_type: "MONTHS",
          percentage: "0.5",
        },
      },
    );
  });

  it("the compiled schedule lumps that same half on the cliff date", () => {
    const program: Program = [
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseDate("2024-01-31")),
        {
          type: "MONTHS",
          length: 1,
          occurrences: 4,
          cliff: twoMonthCliff,
        },
      ),
    ];
    const result = resolveToCore(
      program,
      ctxInput({ grantDate: "2024-01-01" }, 4000),
    );
    if (result.kind !== "template") throw new Error("expected template");
    // 2 of 4 occurrences precede the cliff → 1/2, stored as the exact Numeric "0.5".
    expect(result.template.statements[0].cliff?.percentage).toBe("0.5");
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(events[0]).toEqual({ date: "2024-03-31", amount: "2000" });
  });
});

describe("kernel oracle — a schedule held by its event_condition lays out the grid once fired", () => {
  // The start date is known but the cliff's event_condition waits on events that
  // haven't happened, so nothing can vest yet — a held template. Once the events
  // fire, the same grid walk lands the clamped month-ends. Started on a 31st so the
  // short months show up.
  const program: Program = [
    stmt(portion(1, 1), makeSingletonNode(makeVestingBaseDate("2025-01-31")), {
      type: "MONTHS",
      length: 1,
      occurrences: 4,
      cliff: laterOfUnfired,
    }),
  ];

  it("held → template projects nothing; fired before the start → the four clamped month-ends", () => {
    const held = resolveToCore(program, ctxInput());
    expect(held.kind).toBe("template");
    if (held.kind !== "template") return;
    // Unfired event_condition → the held template releases nothing.
    expect(compile(held.template, held.totalShares, held.runtime)).toEqual([]);

    // Fire both events before the start so the synthetic fold has no lump effect:
    // the grid then lays out evenly on the clamped month-ends, the same walk.
    const fired = resolveToCore(
      program,
      ctxInput({ a: "2024-12-01", b: "2024-12-15" }, 4000),
    );
    if (fired.kind !== "template") throw new Error("expected template");
    const events = compile(fired.template, fired.totalShares, fired.runtime);
    expect(events.map((e) => e.date)).toEqual([
      "2025-02-28",
      "2025-03-31",
      "2025-04-30",
      "2025-05-31",
    ]);
  });
});

describe("kernel oracle — an independent grid beside an event-held sibling routes to events", () => {
  // Half the grant vests on a plain annual schedule; the other half is held behind
  // an event_condition. They're two independent same-start grids, so the program
  // can't collapse to one template → events-only (the held half rides along
  // symbolically). The settled half runs through the same allocation path.
  const program: Program = [
    stmt(portion(1, 2), makeSingletonNode(makeVestingBaseDate("2025-01-01")), {
      type: "MONTHS",
      length: 12,
      occurrences: 2,
    }),
    stmt(portion(1, 2), makeSingletonNode(makeVestingBaseDate("2025-01-01")), {
      type: "MONTHS",
      length: 12,
      occurrences: 2,
      cliff: laterOfUnfired,
    }),
  ];

  it("carries the settled half's dated tranches and flags the held half", () => {
    const result = resolveToCore(program, ctxInput({}, 100000));
    expect(result.kind).toBe("events");
    if (result.kind !== "events") return;
    const resolved = result.installments.filter(isResolved);
    expect(resolved.map((i) => ({ date: i.date, amount: i.amount }))).toEqual([
      { date: "2026-01-01", amount: 25000 },
      { date: "2027-01-01", amount: 25000 },
    ]);
    expect(result.installments.some((i) => i.state === "UNRESOLVED")).toBe(
      true,
    );
  });
});
