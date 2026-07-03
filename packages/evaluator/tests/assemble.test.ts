// The public evaluate path runs through resolve → classify → assemble → core,
// tagging each EvaluatedSchedule by storable fidelity. These assert the three
// arms (template / events / unresolved) end-to-end and the exact-telescoping
// property for template schedules.

import { describe, it, expect } from "vitest";
import type {
  Amount,
  AsOfContextInput,
  Blocker,
  ResolutionContextInput,
  Installment,
  OCTDate,
  Program,
  Schedule,
  Statement,
  VestingNode,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";
import { CONTINGENT_START_SENTINEL } from "@vestlang/utils";
import { evaluateStatement, evaluateProgram } from "../src/evaluate";
import { evaluateProgramAsOf } from "../src/asof";
import {
  makeSingletonSchedule,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
  makeDuration,
  makeVestingBaseGrantDate,
  makeVestingBaseVestingStart,
  scheduleOf,
} from "./helpers";

// Every assertion in this file is about the closed-world resolvesTo verdict
// (which arm a schedule lands in, the dated installments, the blockers), so these
// helpers grab that verdict straight off the result. The firing-invariant
// storable verdict has its own suite in storable.test.ts.
const evalStmt = (stmt: Statement, ctx: ResolutionContextInput) =>
  evaluateStatement(stmt, ctx).resolvesTo;
const evalProgram = (program: Program, ctx: ResolutionContextInput) =>
  evaluateProgram(program, ctx).resolvesTo;

const ctxInput = (
  overrides: Partial<AsOfContextInput> = {},
): AsOfContextInput => ({
  grantDate: "2025-01-01",
  events: {},
  grantQuantity: 100000,
  asOf: "2035-01-01",
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
) => ({
  type: "STATEMENT" as const,
  amount,
  expr: makeSingletonSchedule(start, periodicity),
});

const sum = (xs: { amount: number }[]) => xs.reduce((a, x) => a + x.amount, 0);

// Dates of the RESOLVED installments, in order — the dated part of an arm.
const resolvedDates = (xs: Installment[]): OCTDate[] =>
  xs.flatMap((i) => (i.state === "RESOLVED" ? [i.date] : []));

describe("assemble — template status", () => {
  const cliff12mo = makeSingletonNode(makeVestingBaseVestingStart(), [
    makeDuration(12, "MONTHS", "PLUS"),
  ]);
  const monthly48WithCliff = stmt(
    portion(1, 1),
    makeSingletonNode(makeVestingBaseDate("2025-01-01")),
    { type: "MONTHS", length: 1, occurrences: 48, cliff: cliff12mo },
  );

  it("monthly-48 + 12mo cliff → RESOLVED installments tagged template", () => {
    const out = evalStmt(monthly48WithCliff, ctxInput());
    expect(out.status).toBe("template");
    expect(out.pending).toEqual([]);
    expect(out.dead).toEqual([]);
    expect(out.installments).toHaveLength(37); // cliff lump + 36 monthly
    expect(out.installments.every((i) => i.state === "RESOLVED")).toBe(true);
    expect(out.installments[0]).toMatchObject({
      date: "2026-01-01",
      amount: 25000,
    });
  });

  it("totals telescope EXACTLY to grant quantity", () => {
    const out = evalStmt(monthly48WithCliff, ctxInput());
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
      yearStmt(1, "2025-01-01"),
      yearStmt(3, "2026-01-01"),
      yearStmt(8, "2027-01-01"),
      yearStmt(8, "2028-01-01"),
    ];
    const schedule = evalProgram(program, ctxInput());
    expect(schedule.status).toBe("template");
    expect(sum(schedule.installments)).toBe(100000);
  });
});

describe("assemble — events-only status", () => {
  it("two overlapping independent DATE grids → events-only + reason", () => {
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
    const out = evalProgram(program, ctxInput());
    expect(out.status).toBe("events-only");
    if (out.status !== "events-only") throw new Error("expected events-only");
    // The published resolvesTo arm carries the reason structured (rendered to
    // prose only at the view boundary), so a consumer can gate on the kind.
    expect(out.reason).toEqual({ kind: "OVERLAPPING_ABSOLUTE_STARTS" });
    expect(out.installments.every((i) => i.state === "RESOLVED")).toBe(true);
    expect(resolvedDates(out.installments)).toEqual([
      "2026-01-01",
      "2026-07-01",
    ]);
    expect(sum(out.installments)).toBe(100000);
  });
});

describe("assemble — program collapse regression (evaluateProgram)", () => {
  // Statements anchored to `grantDate + offset` (DSL `FROM +N months`) each used
  // to push a `grantDate` event firing, producing a duplicate-event_id runtime
  // that core's validator rejected. They are absolute service-time DATE anchors,
  // not floating milestones, so the whole program must collapse without throwing.
  it("grantDate-relative starts collapse without a duplicate-firing throw", () => {
    const fromGrant = (num: number, months: number) =>
      stmt(
        portion(num, 100),
        makeSingletonNode(makeVestingBaseGrantDate(), [
          makeDuration(months, "MONTHS", "PLUS"),
        ]),
        { type: "DAYS", length: 0, occurrences: 1 },
      );
    const program: Program = [
      fromGrant(5, 12),
      fromGrant(15, 24),
      fromGrant(80, 36),
    ];
    expect(() => evalProgram(program, ctxInput())).not.toThrow();
    const out = evalProgram(program, ctxInput());
    expect(out.installments.every((i) => i.state === "RESOLVED")).toBe(true);
    expect(sum(out.installments)).toBe(100000); // telescopes exactly
  });

  // Two portions floating to the SAME named event share one firing (dedup) and
  // collapse to one template — not a duplicate-firing throw.
  it("two portions on the same fired event → one template, deduped firing", () => {
    const ipoPortion = (num: number) =>
      stmt(portion(num, 2), makeSingletonNode(makeVestingBaseEvent("ipo")), {
        type: "DAYS",
        length: 0,
        occurrences: 1,
      });
    const program: Program = [ipoPortion(1), ipoPortion(1)];
    const out = evalProgram(
      program,
      ctxInput({
        grantDate: "2025-01-01",
        events: { ipo: "2026-06-15" },
      }),
    );
    expect(out.status).toBe("template");
    expect(sum(out.installments)).toBe(100000);
  });
});

describe("assemble — atomic unfired EVENT start: classify on the spec", () => {
  // An unfired *atomic* EVENT start is a valid canonical template (a contingent
  // start: a DATE base on the sentinel + one `evt:start` recipe), not `unresolved`:
  // pending is the absence of a witness, carried in `blockers`, not a property of
  // the spec's representability.
  it("atomic unfired EVENT start → contingent template (sentinel + evt:start, symbolic installment + blocker)", () => {
    const program: Program = [
      stmt(portion(1, 1), makeSingletonNode(makeVestingBaseEvent("ipo")), {
        type: "MONTHS",
        length: 0,
        occurrences: 1,
      }),
    ];
    const out = evalStmt(program[0], ctxInput({ grantQuantity: 4800 })); // ipo not fired
    if (out.status !== "template")
      throw new Error(`expected template, got ${out.status}`);
    // No firing → one UNRESOLVED installment carrying the full portion's shares.
    expect(out.installments).toHaveLength(1);
    expect(out.installments[0].state).toBe("UNRESOLVED");
    expect(out.installments[0].amount).toBe(4800);
    expect(
      out.pending.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
    // The template holds a DATE statement on the contingent-start sentinel; the
    // recipe to re-derive the real start lives under the reserved `evt:start` key.
    expect(out.template.statements).toHaveLength(1);
    expect(out.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(Object.keys(out.sourceMap)).toEqual(["evt:start"]);
    expect(out.sourceMap["evt:start"].definition).toContain("ipo");
    expect(out.runtime.eventFirings ?? []).toEqual([]);
  });

  // The HYBRID case: a DATE portion vesting now + an unfired EVENT portion. This is
  // two DISTINCT start origins (a fixed date beside an event), and canonical hoists
  // exactly one start — so it can't be one template. It falls to events-only with
  // MULTIPLE_START_ORIGINS, but the already-vested dated installments still survive
  // and the pending portion rides along symbolically.
  it("75% MONTHLY + 25% unfired EVENT → events-only/MULTIPLE_START_ORIGINS, 3,600 dated + pending blocker", () => {
    const program: Program = [
      stmt(
        portion(3, 4),
        makeSingletonNode(makeVestingBaseDate("2025-01-01")),
        {
          type: "MONTHS",
          length: 1,
          occurrences: 48,
        },
      ),
      stmt(portion(1, 4), makeSingletonNode(makeVestingBaseEvent("ipo")), {
        type: "MONTHS",
        length: 0,
        occurrences: 1,
      }),
    ];
    const out = evalProgram(program, ctxInput({ grantQuantity: 4800 })); // ipo unfired
    if (out.status !== "events-only")
      throw new Error(`expected events-only, got ${out.status}`);
    expect(out.reason.kind).toBe("MULTIPLE_START_ORIGINS");
    // Dated tranches (3600) + one UNRESOLVED installment for the pending 25%.
    const resolved = out.installments.filter((i) => i.state === "RESOLVED");
    const unresolved = out.installments.filter((i) => i.state === "UNRESOLVED");
    expect(sum(resolved)).toBe(3600);
    expect(sum(unresolved)).toBe(1200);
    expect(
      out.pending.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
  });
});

describe("assemble — combinator-over-anchors → contingent start (evt:start)", () => {
  // A combinator over a *start anchor* selects an anchor, not a structure: the
  // downstream grid is fixed regardless of which arm wins, so a single such start
  // lowers to ONE canonical template — a DATE base on the contingent-start sentinel
  // plus the gate's recipe under the reserved `evt:start` key. Pending in
  // `blockers`, recipe in `sourceMap`.

  // Recursively search a blocker tree for the unfired-event leaf.
  const findsEventNotOccurred = (bs: Blocker[], event: string): boolean =>
    bs.some(
      (b) =>
        (b.type === "EVENT_NOT_YET_OCCURRED" && b.event === event) ||
        ((b.type === "UNRESOLVED_SELECTOR" ||
          b.type === "IMPOSSIBLE_SELECTOR") &&
          findsEventNotOccurred(b.blockers as Blocker[], event)),
    );

  // `+12mo` desugars to `grantDate + 12 months` (a system anchor → DATE);
  // `EVENT "ipo"` is the genuine named condition that earns the synthetic event.
  const plus12mo = () =>
    makeSingletonNode(makeVestingBaseGrantDate(), [
      makeDuration(12, "MONTHS", "PLUS"),
    ]);
  const ipo = () => makeSingletonNode(makeVestingBaseEvent("ipo"));

  const combinatorStmt = (
    sel: "NODE_LATER_OF" | "NODE_EARLIER_OF",
    amount: Amount,
  ): Statement => ({
    type: "STATEMENT",
    amount,
    expr: {
      type: "SCHEDULE",
      vesting_start: { type: sel, items: [plus12mo(), ipo()] },
      periodicity: { type: "MONTHS", length: 1, occurrences: 48 },
    },
  });

  it("LATER OF(+12mo, EVENT ipo), ipo unfired → contingent template (sentinel + evt:start)", () => {
    const out = evalStmt(
      combinatorStmt("NODE_LATER_OF", portion(1, 1)),
      ctxInput(),
    );
    if (out.status !== "template")
      throw new Error(`expected template, got ${out.status}`);
    // One DATE statement on the contingent-start sentinel.
    expect(out.template.statements).toHaveLength(1);
    expect(out.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    // No witness — the contingent start hasn't fired.
    expect(out.runtime.eventFirings ?? []).toEqual([]);
    // The gate's recipe lives in the source map under the reserved key.
    expect(Object.keys(out.sourceMap)).toEqual(["evt:start"]);
    expect(out.sourceMap["evt:start"].definition).toMatch(/LATER OF/);
    expect(out.sourceMap["evt:start"].definition).toMatch(/ipo/);
    // Pending-ness rides `blockers`; UNRESOLVED installments carry the share claim.
    // LATER OF with one settled arm → partial=true, so 48 symbolic start+N tranches.
    expect(findsEventNotOccurred(out.pending, "ipo")).toBe(true);
    expect(out.installments.every((i) => i.state === "UNRESOLVED")).toBe(true);
    expect(out.installments.reduce((a, i) => a + i.amount, 0)).toBe(100000);
  });

  it("EARLIER OF(DATE future, EVENT ipo), ipo unfired → resolvesTo commits to the date floor, discloses ipo (#251)", () => {
    // The 2030 date arm resolves on its own; ipo is unfired. The date arm is a
    // LOWER bound on the start (the latest it could possibly be), so closed-world
    // `resolvesTo` COMMITS to it — a guaranteed vesting floor that any real ipo
    // firing only moves earlier — and discloses ipo as still-absent through 2030.
    // (Pre-#251 this stayed pending forever and externalized as a synthetic event.)
    const earlierStmt = {
      type: "STATEMENT",
      amount: portion(1, 1),
      expr: {
        type: "SCHEDULE",
        vesting_start: {
          type: "NODE_EARLIER_OF",
          items: [makeSingletonNode(makeVestingBaseDate("2030-01-01")), ipo()],
        },
        periodicity: { type: "MONTHS", length: 1, occurrences: 48 },
      },
    } as Statement;
    const schedule = evaluateStatement(
      earlierStmt,
      ctxInput({ asOf: "2025-06-01" }),
    );

    // Resolution: a DATE template hoisted to the committed floor — no synthetic
    // event, the grid lands off 2030-01-01.
    const res = schedule.resolvesTo;
    if (res.status !== "template")
      throw new Error(`expected template, got ${res.status}`);
    expect(res.runtime.startDate).toBe("2030-01-01");
    expect(Object.keys(res.sourceMap)).toHaveLength(0);
    // The committed-arm disclosure: ipo assumed absent, surfaced in pending and as
    // an absence assumption stamped through the committed date.
    expect(findsEventNotOccurred(res.pending, "ipo")).toBe(true);
    expect(schedule.absenceAssumptions).toContainEqual({
      eventId: "ipo",
      through: "2030-01-01",
      direction: "before",
      inclusive: false,
      consequence: "grid-shift",
    });

    // Interchange (firing-blind, AC 5) is unchanged: it never commits, so it still
    // externalizes the gate as a contingent start (sentinel + evt:start recipe).
    const ix = schedule.storable;
    if (ix.status !== "template")
      throw new Error(`expected storable template, got ${ix.status}`);
    expect(ix.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(Object.keys(ix.sourceMap)).toEqual(["evt:start"]);
  });

  it("two PLUS portions on the same contingent anchor are two origins → MULTIPLE_START_ORIGINS", () => {
    // canonical hoists ONE start and chains DATE statements off it, so two parallel
    // PLUS portions can't both anchor on the one hoisted contingent start — even on
    // the byte-identical recipe. (They stored as a single template via per-statement
    // EVENT bases before; Carta's single vestingStartDate couldn't hold them either.
    // Still DSL-expressible.)
    const program: Program = [
      combinatorStmt("NODE_LATER_OF", portion(3, 4)),
      combinatorStmt("NODE_LATER_OF", portion(1, 4)),
    ];
    const out = evalProgram(program, ctxInput());
    if (out.status !== "events-only")
      throw new Error(`expected events-only, got ${out.status}`);
    expect(out.reason.kind).toBe("MULTIPLE_START_ORIGINS");
  });

  it("100% MONTHLY OVER 48 FROM LATER OF(+12mo, EVENT ipo) → contingent template", () => {
    const out = evalStmt(
      combinatorStmt("NODE_LATER_OF", portion(1, 1)),
      ctxInput({ grantQuantity: 4800 }),
    );
    if (out.status !== "template")
      throw new Error(`expected template, got ${out.status}`);
    const s = out.template.statements[0];
    expect(scheduleOf(s)!.occurrences).toBe(48);
    expect(scheduleOf(s)!.period).toBe(1);
    expect(scheduleOf(s)!.period_type).toBe("MONTHS");
    expect(out.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(Object.keys(out.sourceMap)).toEqual(["evt:start"]);
    expect(findsEventNotOccurred(out.pending, "ipo")).toBe(true);
    // No firing → UNRESOLVED installments carrying the share claim.
    // LATER OF with one settled arm → partial=true, 48 symbolic start+N tranches.
    expect(out.installments.every((i) => i.state === "UNRESOLVED")).toBe(true);
    expect(out.installments.reduce((a, i) => a + i.amount, 0)).toBe(4800);
  });

  it("pure-date combinator earns NO synthetic event (resolves to a DATE template)", () => {
    // LATER OF(+12mo, +24mo) — no named event, so it fails the admission test and
    // resolves to a single DATE anchor (the later). Template, no source map.
    const out = evalStmt(
      {
        type: "STATEMENT",
        amount: portion(1, 1),
        expr: {
          type: "SCHEDULE",
          vesting_start: {
            type: "NODE_LATER_OF",
            items: [
              makeSingletonNode(makeVestingBaseGrantDate(), [
                makeDuration(12, "MONTHS", "PLUS"),
              ]),
              makeSingletonNode(makeVestingBaseGrantDate(), [
                makeDuration(24, "MONTHS", "PLUS"),
              ]),
            ],
          },
          periodicity: { type: "MONTHS", length: 1, occurrences: 48 },
        },
      },
      ctxInput(), // asOf 2035 → both date arms resolve
    );
    if (out.status !== "template")
      throw new Error(`expected template, got ${out.status}`);
    expect(out.sourceMap).toEqual({});
  });
});

describe("assemble — gated atomic start → contingent start (evt:start)", () => {
  // A BEFORE/AFTER gate carries a guard, so a gated atomic start externalizes the
  // same way a combinator does: a DATE base on the contingent-start sentinel plus
  // the whole guarded expression under the reserved `evt:start` recipe. This is
  // what keeps the guard from being dropped at the storage boundary (#18), and it
  // makes the two word-orders of the same gate lower identically (#54).
  //
  // The 2030 date resolves fine even though asOf is years earlier; the gate stays
  // pending because the *event* side is unfired (an unrecorded event can't settle
  // a before/after test), not because the date is somehow unknown.
  const gatedCtx = ctxInput({ asOf: "2026-06-01" });

  // `FROM EVENT a BEFORE DATE 2030-01-01` — event in the base, date in the gate.
  const eventBeforeDate: VestingNode<"GRANT_DATE"> = {
    type: "NODE",
    base: makeVestingBaseEvent("a"),
    offsets: [],
    condition: {
      type: "ATOM",
      constraint: {
        type: "BEFORE",
        base: makeSingletonNode(makeVestingBaseDate("2030-01-01")),
        strict: false,
      },
    },
  };

  // `FROM DATE 2030-01-01 BEFORE EVENT e` — the mirror: date in the base, event
  // in the gate. Logically equivalent ordering; must lower the same way.
  const dateBeforeEvent: VestingNode<"GRANT_DATE"> = {
    type: "NODE",
    base: makeVestingBaseDate("2030-01-01"),
    offsets: [],
    condition: {
      type: "ATOM",
      constraint: {
        type: "BEFORE",
        base: makeSingletonNode(makeVestingBaseEvent("e")),
        strict: false,
      },
    },
  };

  const monthly = { type: "MONTHS", length: 1, occurrences: 48 } as const;

  it("EVENT a BEFORE DATE (future), a unfired → evt:start carrying the guard", () => {
    const out = evalStmt(
      stmt(portion(1, 1), eventBeforeDate, monthly),
      gatedCtx,
    );
    if (out.status !== "template")
      throw new Error(`expected template, got ${out.status}`);
    expect(out.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    // The guard must survive into the stored recipe, not be dropped.
    expect(Object.keys(out.sourceMap)).toEqual(["evt:start"]);
    expect(out.sourceMap["evt:start"].definition).toMatch(/BEFORE/);
    expect(out.sourceMap["evt:start"].definition).toMatch(/2030-01-01/);
    expect(out.sourceMap["evt:start"].definition).toMatch(/\ba\b/);
    // No firing yet; pending-ness rides blockers, share claim in UNRESOLVED installment.
    expect(out.runtime.eventFirings ?? []).toEqual([]);
    expect(out.installments).toHaveLength(1);
    expect(out.installments[0].state).toBe("UNRESOLVED");
    expect(out.installments[0].amount).toBe(100000);
  });

  it("DATE (future) BEFORE EVENT e → the mirror order externalizes the same way", () => {
    const out = evalStmt(
      stmt(portion(1, 1), dateBeforeEvent, monthly),
      gatedCtx,
    );
    if (out.status !== "template")
      throw new Error(`expected template, got ${out.status}`);
    expect(out.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(Object.keys(out.sourceMap)).toEqual(["evt:start"]);
    expect(out.sourceMap["evt:start"].definition).toMatch(/BEFORE/);
    expect(out.sourceMap["evt:start"].definition).toMatch(/\be\b/);
    expect(out.installments).toHaveLength(1);
    expect(out.installments[0].state).toBe("UNRESOLVED");
    expect(out.installments[0].amount).toBe(100000);
  });

  it("a bare ungated EVENT start routes through evt:start too (AC 7)", () => {
    const out = evalStmt(
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseEvent("a")),
        monthly,
      ),
      gatedCtx,
    );
    if (out.status !== "template")
      throw new Error(`expected template, got ${out.status}`);
    // A bare event start is a contingent start too: DATE base on the sentinel, with
    // the bare `EVENT a` recipe under `evt:start` — no direct event-named base
    // (which no longer exists).
    expect(out.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(Object.keys(out.sourceMap)).toEqual(["evt:start"]);
    expect(out.sourceMap["evt:start"].definition).toContain("a");
  });
});

describe("assemble — future-dated pure-date schedules resolve", () => {
  // A combinator over nothing but dates is fully determined, even when an arm is
  // years out. A literal date is a known value no matter where asOf sits, so the
  // LATER OF just picks the later of the two — here the 2030 arm — and lowers to
  // a plain date template. The installments land in the future, but they're still
  // RESOLVED: "has this vested yet?" is a projection question, asked later by
  // comparing each date to asOf, not a reason to leave the schedule unresolved.
  it("pure-date LATER OF with a future DATE arm resolves to a template", () => {
    const laterOfSchedule: Schedule = {
      type: "SCHEDULE",
      vesting_start: {
        type: "NODE_LATER_OF",
        items: [
          makeSingletonNode(makeVestingBaseDate("2030-01-01")),
          makeSingletonNode(makeVestingBaseGrantDate(), [
            makeDuration(12, "MONTHS", "PLUS"),
          ]),
        ],
      },
      periodicity: { type: "MONTHS", length: 1, occurrences: 48 },
    };
    const program: Program = [
      { type: "STATEMENT", amount: portion(1, 1), expr: laterOfSchedule },
    ];
    const out = evalStmt(program[0], ctxInput({ asOf: "2026-06-01" }));
    if (out.status !== "template")
      throw new Error(`expected template, got ${out.status}`);
    // Pure dates: nothing to externalize, so no synthetic event.
    expect(out.sourceMap).toEqual({});
    // Anchored on the later (2030) arm, with concrete RESOLVED installments.
    expect(out.installments.length).toBeGreaterThan(0);
    expect(out.installments.every((i) => i.state === "RESOLVED")).toBe(true);
    const first = out.installments[0];
    expect(first.state === "RESOLVED" && first.date >= "2030-01-01").toBe(true);
  });
});

describe("assemble — impossible status", () => {
  // `EVENT a BEFORE DATE 2025-01-01` with a firing after the deadline: no witness
  // assignment can ever satisfy it → the whole (single-statement) grant is void.
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

  it("contradictory statement → status impossible, all installments IMPOSSIBLE", () => {
    const out = evalStmt(
      voidStmt,
      ctxInput({
        grantDate: "2025-01-01",
        events: { a: "2025-06-01" },
      }),
    );
    expect(out.status).toBe("impossible");
    if (out.status !== "impossible") return;
    expect(out.installments.length).toBeGreaterThan(0);
    expect(out.installments.every((i) => i.state === "IMPOSSIBLE")).toBe(true);
    // A terminal program is all-dead: the contradictions land in `dead`, nothing
    // is pending.
    expect(out.pending).toHaveLength(0);
    expect(out.dead.every((b) => b.type === "IMPOSSIBLE_CONDITION")).toBe(true);
  });

  it("whole-program collapse: all-void program → impossible", () => {
    const out = evalProgram(
      [voidStmt, voidStmt],
      ctxInput({
        grantDate: "2025-01-01",
        events: { a: "2025-06-01" },
      }),
    );
    expect(out.status).toBe("impossible");
  });

  it("[resolving, void] program → unresolved, projecting the resolved half (#28)", () => {
    const resolving = stmt(
      portion(1, 2),
      makeSingletonNode(makeVestingBaseDate("2025-01-01")),
      { type: "MONTHS", length: 12, occurrences: 2 },
    );
    const half = stmt(portion(1, 2), voidStart, {
      type: "MONTHS",
      length: 12,
      occurrences: 2,
    });
    const out = evalProgram(
      [resolving, half],
      ctxInput({ grantDate: "2025-01-01", events: { a: "2025-06-01" } }),
    );
    expect(out.status).toBe("unresolved");
    expect(resolvedDates(out.installments)).toEqual([
      "2026-01-01",
      "2027-01-01",
    ]);
    expect(sum(out.installments.filter((i) => i.state === "RESOLVED"))).toBe(
      50000,
    );
    expect(out.installments.some((i) => i.state === "IMPOSSIBLE")).toBe(true);
  });
});

// R2-B1: pending portions on the template arm keep their share claims as UNRESOLVED
// installments, so as-of tallies and summaries account for them rather than
// silently dropping them.
describe("template arm — pending channel (R2-B1)", () => {
  // Statement A: 3/4 from DATE 2024-01-01, 2 monthly occurrences → 3600 shares
  // Statement B: 1/4 from EVENT ipo, 2 monthly occurrences → 1200 shares pending
  const mixedProgram = (): Program => [
    stmt(portion(3, 4), makeSingletonNode(makeVestingBaseDate("2024-01-01")), {
      type: "MONTHS",
      length: 1,
      occurrences: 2,
    }),
    stmt(portion(1, 4), makeSingletonNode(makeVestingBaseEvent("ipo")), {
      type: "MONTHS",
      length: 1,
      occurrences: 2,
    }),
  ];

  it("mixed DATE + pending EVENT → events-only (two origins), dated + UNRESOLVED installments", () => {
    // A fixed dated start beside a contingent event start is two start origins, so
    // it can't be one template — but the dated portion still vests and the pending
    // portion rides along symbolically.
    const out = evalProgram(
      mixedProgram(),
      ctxInput({ grantDate: "2024-01-01", grantQuantity: 4800 }),
    );
    expect(out.status).toBe("events-only");
    if (out.status !== "events-only") return;
    expect(out.reason.kind).toBe("MULTIPLE_START_ORIGINS");

    const resolved = out.installments.filter((i) => i.state === "RESOLVED");
    const unresolved = out.installments.filter((i) => i.state === "UNRESOLVED");
    expect(sum(resolved)).toBe(3600); // dated portion
    expect(sum(unresolved)).toBe(1200); // pending EVENT portion

    // Blocker for ipo appears exactly once — not duplicated by the new channel.
    const ipoBlockers = out.pending.filter(
      (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
    );
    expect(ipoBlockers).toHaveLength(1);
  });

  it("evaluateProgramAsOf: unresolved === 1200, vested === 3600, no dated unvested", () => {
    const result = evaluateProgramAsOf(mixedProgram(), {
      grantDate: "2024-01-01",
      grantQuantity: 4800,
      events: {},
      asOf: "2026-01-01",
    });
    expect(result.unresolved).toBe(1200);
    expect(sum(result.vested)).toBe(3600);
    expect(result.unvested).toHaveLength(0);
  });

  it("pure pending program: evaluateProgramAsOf reports unresolved === grantQuantity", () => {
    const pureEventProgram: Program = [
      stmt(portion(1, 1), makeSingletonNode(makeVestingBaseEvent("ipo")), {
        type: "MONTHS",
        length: 1,
        occurrences: 2,
      }),
    ];
    const result = evaluateProgramAsOf(pureEventProgram, {
      grantDate: "2024-01-01",
      grantQuantity: 4800,
      events: {},
      asOf: "2026-01-01",
    });
    // The share claim rides through the UNRESOLVED installment,
    // not the empty-stream fallback — same number, explicit path.
    expect(result.unresolved).toBe(4800);
    expect(sum(result.vested)).toBe(0);
  });

  it("regression guard: plain dated template installments are all RESOLVED", () => {
    const dateProg: Program = [
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseDate("2024-01-01")),
        { type: "MONTHS", length: 1, occurrences: 4 },
      ),
    ];
    const out = evalProgram(
      dateProg,
      ctxInput({ grantDate: "2024-01-01", grantQuantity: 4800 }),
    );
    expect(out.status).toBe("template");
    if (out.status !== "template") return;
    expect(out.installments.every((i) => i.state === "RESOLVED")).toBe(true);
    expect(sum(out.installments)).toBe(4800);
  });
});
