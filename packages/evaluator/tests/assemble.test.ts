// The public evaluate path runs through resolve → classify → assemble → core,
// tagging each EvaluatedSchedule by interchange fidelity. These assert the three
// arms (template / events / unresolved) end-to-end and the exact-telescoping
// property for template schedules.

import { describe, it, expect } from "vitest";
import type {
  Amount,
  Blocker,
  EvaluationContextInput,
  OCTDate,
  Program,
  Schedule,
  Statement,
  VestingNode,
  VestingPeriod,
} from "@vestlang/types";
import { evaluateStatement, evaluateProgram } from "../src/evaluate/index";
import {
  makeSingletonSchedule,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
  makeDuration,
  makeVestingBaseGrantDate,
  makeVestingBaseVestingStart,
} from "./helpers";

const ctxInput = (
  overrides: Partial<EvaluationContextInput> = {},
): EvaluationContextInput => ({
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
  start: VestingNode,
  periodicity: VestingPeriod,
) => ({
  type: "STATEMENT" as const,
  amount,
  expr: makeSingletonSchedule(start, periodicity),
});

const sum = (xs: { amount: number }[]) => xs.reduce((a, x) => a + x.amount, 0);

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
    const out = evaluateStatement(monthly48WithCliff, ctxInput());
    expect(out.status).toBe("template");
    expect(out.blockers).toEqual([]);
    expect(out.installments).toHaveLength(37); // cliff lump + 36 monthly
    expect(out.installments.every((i) => i.meta.state === "RESOLVED")).toBe(
      true,
    );
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
      yearStmt(1, "2025-01-01"),
      yearStmt(3, "2026-01-01"),
      yearStmt(8, "2027-01-01"),
      yearStmt(8, "2028-01-01"),
    ];
    const schedules = evaluateProgram(program, ctxInput());
    expect(schedules).toHaveLength(1); // whole program → one template schedule
    expect(schedules[0].status).toBe("template");
    expect(sum(schedules[0].installments)).toBe(100000);
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
    const [out] = evaluateProgram(program, ctxInput());
    expect(out.status).toBe("events-only");
    if (out.status !== "events-only") throw new Error("expected events-only");
    expect(out.reason).toBeTruthy();
    expect(out.installments.every((i) => i.meta.state === "RESOLVED")).toBe(
      true,
    );
    expect(out.installments.map((i) => i.date)).toEqual([
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
    expect(() => evaluateProgram(program, ctxInput())).not.toThrow();
    const [out] = evaluateProgram(program, ctxInput());
    expect(out.installments.every((i) => i.meta.state === "RESOLVED")).toBe(
      true,
    );
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
    const [out] = evaluateProgram(
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
  // An unfired *atomic* EVENT start is a valid canonical template (an EVENT
  // statement with no firing), not `unresolved`: pending is the absence of a
  // witness, carried in `blockers`, not a property of the spec's representability.
  it("atomic unfired EVENT start → template (empty projection + blocker)", () => {
    const program: Program = [
      stmt(portion(1, 1), makeSingletonNode(makeVestingBaseEvent("ipo")), {
        type: "MONTHS",
        length: 0,
        occurrences: 1,
      }),
    ];
    const out = evaluateStatement(program[0], ctxInput()); // ipo not fired
    if (out.status !== "template")
      throw new Error(`expected template, got ${out.status}`);
    expect(out.installments).toEqual([]); // no firing → nothing projected yet
    expect(
      out.blockers.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
    // The template holds the EVENT statement; runtime carries no witness.
    expect(out.template.statements).toHaveLength(1);
    expect(out.template.statements[0].vesting_base).toEqual({
      type: "EVENT",
      event_id: "ipo",
    });
    expect(out.runtime.eventFirings ?? []).toEqual([]);
  });

  // The HYBRID case: a DATE portion vesting now + an unfired EVENT portion. The
  // unfired event must NOT poison the program — the already-vested, fully-dated
  // DATE installments must survive.
  it("75% MONTHLY + 25% unfired EVENT → template, 3,600 dated + pending blocker", () => {
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
    const [out] = evaluateProgram(program, ctxInput({ grantQuantity: 4800 })); // ipo unfired
    if (out.status !== "template")
      throw new Error(`expected template, got ${out.status}`);
    expect(out.installments.every((i) => i.meta.state === "RESOLVED")).toBe(
      true,
    );
    expect(sum(out.installments)).toBe(3600); // the 75% time-based portion, dated
    expect(
      out.blockers.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
    expect(out.template.statements).toHaveLength(2); // DATE grid + pending EVENT
  });
});

describe("assemble — combinator-over-anchors → synthetic event", () => {
  // A combinator over a *start anchor* selects an anchor, not a structure: the
  // downstream grid is fixed regardless of which arm wins, so it lowers to ONE
  // canonical template by externalizing the gate as a synthetic event + a
  // source-map definition. Pending in `blockers`, definition in `sourceMap`.

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

  it("LATER OF(+12mo, EVENT ipo), ipo unfired → template + synthetic event", () => {
    const out = evaluateStatement(
      combinatorStmt("NODE_LATER_OF", portion(1, 1)),
      ctxInput(),
    );
    if (out.status !== "template")
      throw new Error(`expected template, got ${out.status}`);
    // One EVENT statement anchored on a minted synthetic id.
    expect(out.template.statements).toHaveLength(1);
    const base = out.template.statements[0].vesting_base;
    expect(base.type).toBe("EVENT");
    const eventId = base.type === "EVENT" ? base.event_id : "";
    expect(eventId).toMatch(/^evt_/);
    // No witness — the synthetic event hasn't fired.
    expect(out.runtime.eventFirings ?? []).toEqual([]);
    // The gate's meaning lives in the source map, keyed by the same id.
    expect(Object.keys(out.sourceMap)).toEqual([eventId]);
    expect(out.sourceMap[eventId].definition).toMatch(/LATER OF/);
    expect(out.sourceMap[eventId].definition).toMatch(/ipo/);
    // Pending-ness rides `blockers`; projection empty (event not fired).
    expect(findsEventNotOccurred(out.blockers, "ipo")).toBe(true);
    expect(out.installments).toEqual([]);
  });

  it("EARLIER OF(DATE future, EVENT ipo) before the cap → template + synthetic event", () => {
    // The 2030 date arm resolves on its own (a fixed date is always known), but
    // EARLIER_OF still can't settle: ipo is unfired and could be recorded earlier
    // than 2030, so the date isn't provably the earliest. The selector stays
    // pending, and because it names an event the whole thing externalizes as one
    // synthetic event rather than resolving early to the date.
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
    const out = evaluateStatement(
      earlierStmt,
      ctxInput({ asOf: "2025-06-01" }),
    );
    if (out.status !== "template")
      throw new Error(`expected template, got ${out.status}`);
    const base = out.template.statements[0].vesting_base;
    expect(base.type).toBe("EVENT");
    expect(Object.keys(out.sourceMap)).toHaveLength(1);
    expect(findsEventNotOccurred(out.blockers, "ipo")).toBe(true);
  });

  it("two portions on the same anchor share one event_id + one source-map entry", () => {
    const program: Program = [
      combinatorStmt("NODE_LATER_OF", portion(3, 4)),
      combinatorStmt("NODE_LATER_OF", portion(1, 4)),
    ];
    const [out] = evaluateProgram(program, ctxInput());
    if (out.status !== "template")
      throw new Error(`expected template, got ${out.status}`);
    expect(out.template.statements).toHaveLength(2);
    const ids = out.template.statements.map((s) =>
      s.vesting_base.type === "EVENT" ? s.vesting_base.event_id : undefined,
    );
    expect(ids[0]).toBeDefined();
    expect(ids[0]).toBe(ids[1]); // same gate → same surrogate
    expect(Object.keys(out.sourceMap)).toEqual([ids[0]]); // one entry, deduped
  });

  it("100% MONTHLY OVER 48 FROM LATER OF(+12mo, EVENT ipo) → synthetic event", () => {
    const out = evaluateStatement(
      combinatorStmt("NODE_LATER_OF", portion(1, 1)),
      ctxInput({ grantQuantity: 4800 }),
    );
    if (out.status !== "template")
      throw new Error(`expected template, got ${out.status}`);
    const s = out.template.statements[0];
    expect(s.vesting_base.type).toBe("EVENT");
    expect(s.occurrences).toBe(48);
    expect(s.period).toBe(1);
    expect(s.period_type).toBe("MONTHS");
    expect(Object.keys(out.sourceMap)).toHaveLength(1);
    expect(findsEventNotOccurred(out.blockers, "ipo")).toBe(true);
    expect(out.installments).toEqual([]); // no firing → nothing projected yet
  });

  it("pure-date combinator earns NO synthetic event (resolves to a DATE template)", () => {
    // LATER OF(+12mo, +24mo) — no named event, so it fails the admission test and
    // resolves to a single DATE anchor (the later). Template, no source map.
    const out = evaluateStatement(
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
    expect(out.template.statements[0].vesting_base.type).toBe("DATE");
    expect(out.sourceMap).toEqual({});
  });
});

describe("assemble — gated atomic start → synthetic event", () => {
  // A BEFORE/AFTER gate carries a guard a bare EVENT base can't hold, so a gated
  // atomic start externalizes the same way a combinator does: one synthetic event
  // whose source-map definition carries the whole guarded expression. This is
  // what keeps the guard from being dropped at the storage boundary (#18), and it
  // makes the two word-orders of the same gate lower identically (#54).
  //
  // The 2030 date resolves fine even though asOf is years earlier; the gate stays
  // pending because the *event* side is unfired (an unrecorded event can't settle
  // a before/after test), not because the date is somehow unknown.
  const gatedCtx = ctxInput({ asOf: "2026-06-01" });

  // `FROM EVENT a BEFORE DATE 2030-01-01` — event in the base, date in the gate.
  const eventBeforeDate: VestingNode = {
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
  const dateBeforeEvent: VestingNode = {
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

  it("EVENT a BEFORE DATE (future), a unfired → synthetic event carrying the guard", () => {
    const out = evaluateStatement(
      stmt(portion(1, 1), eventBeforeDate, monthly),
      gatedCtx,
    );
    if (out.status !== "template")
      throw new Error(`expected template, got ${out.status}`);
    const base = out.template.statements[0].vesting_base;
    expect(base.type).toBe("EVENT");
    const eventId = base.type === "EVENT" ? base.event_id : "";
    expect(eventId).toMatch(/^evt_/);
    // The guard must survive into the stored definition, not be dropped.
    expect(Object.keys(out.sourceMap)).toEqual([eventId]);
    expect(out.sourceMap[eventId].definition).toMatch(/BEFORE/);
    expect(out.sourceMap[eventId].definition).toMatch(/2030-01-01/);
    expect(out.sourceMap[eventId].definition).toMatch(/\ba\b/);
    // No firing yet; pending-ness rides blockers, projection empty.
    expect(out.runtime.eventFirings ?? []).toEqual([]);
    expect(out.installments).toEqual([]);
  });

  it("DATE (future) BEFORE EVENT e → the mirror order externalizes the same way", () => {
    const out = evaluateStatement(
      stmt(portion(1, 1), dateBeforeEvent, monthly),
      gatedCtx,
    );
    if (out.status !== "template")
      throw new Error(`expected template, got ${out.status}`);
    const base = out.template.statements[0].vesting_base;
    expect(base.type).toBe("EVENT");
    expect(Object.keys(out.sourceMap)).toHaveLength(1);
    const [id] = Object.keys(out.sourceMap);
    expect(out.sourceMap[id].definition).toMatch(/BEFORE/);
    expect(out.sourceMap[id].definition).toMatch(/\be\b/);
    expect(out.installments).toEqual([]);
  });

  it("a bare ungated EVENT start stays a plain floating event (no synthetic id)", () => {
    const out = evaluateStatement(
      stmt(
        portion(1, 1),
        makeSingletonNode(makeVestingBaseEvent("a")),
        monthly,
      ),
      gatedCtx,
    );
    if (out.status !== "template")
      throw new Error(`expected template, got ${out.status}`);
    const base = out.template.statements[0].vesting_base;
    expect(base.type).toBe("EVENT");
    // The real event id, NOT a minted synthetic one — and no source map.
    expect(base.type === "EVENT" ? base.event_id : "").toBe("a");
    expect(out.sourceMap).toEqual({});
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
    const out = evaluateStatement(program[0], ctxInput({ asOf: "2026-06-01" }));
    if (out.status !== "template")
      throw new Error(`expected template, got ${out.status}`);
    // Pure dates: nothing to externalize, so no synthetic event.
    expect(out.sourceMap).toEqual({});
    // Anchored on the later (2030) arm, with concrete RESOLVED installments.
    expect(out.installments.length).toBeGreaterThan(0);
    expect(out.installments.every((i) => i.meta.state === "RESOLVED")).toBe(
      true,
    );
    expect(out.installments[0].date >= "2030-01-01").toBe(true);
  });
});

describe("assemble — impossible status", () => {
  // `EVENT a BEFORE DATE 2025-01-01` with a firing after the deadline: no witness
  // assignment can ever satisfy it → the whole (single-statement) grant is void.
  const voidStart: VestingNode = {
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
    const out = evaluateStatement(
      voidStmt,
      ctxInput({
        grantDate: "2025-01-01",
        events: { a: "2025-06-01" },
      }),
    );
    expect(out.status).toBe("impossible");
    if (out.status !== "impossible") return;
    expect(out.installments.length).toBeGreaterThan(0);
    expect(out.installments.every((i) => i.meta.state === "IMPOSSIBLE")).toBe(
      true,
    );
    expect(out.blockers.every((b) => b.type === "IMPOSSIBLE_CONDITION")).toBe(
      true,
    );
  });

  it("whole-program collapse: all-void program → impossible", () => {
    const [out] = evaluateProgram(
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
    const [out] = evaluateProgram(
      [resolving, half],
      ctxInput({ grantDate: "2025-01-01", events: { a: "2025-06-01" } }),
    );
    expect(out.status).toBe("unresolved");
    const resolved = out.installments.filter(
      (i) => i.meta.state === "RESOLVED",
    );
    expect(resolved.map((i) => i.date)).toEqual(["2026-01-01", "2027-01-01"]);
    expect(sum(resolved)).toBe(50000);
    expect(out.installments.some((i) => i.meta.state === "IMPOSSIBLE")).toBe(
      true,
    );
  });
});
