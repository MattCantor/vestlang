// THEN chains: a head plus one or more tails, where each tail picks up the
// timeline exactly where the previous segment ended. A date-origin chain should
// classify to a single `template`, and its dates must match what core's compiler
// produces for the same schedule — that equivalence is what these tests pin.

import { describe, it, expect } from "vitest";
import { addPeriod, compile } from "@vestlang/core";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import type {
  Amount,
  AsOfContextInput,
  Installment,
  OCTDate,
  Program,
  Statement,
  VestingPeriod,
} from "@vestlang/types";
import { evaluateProgram, evaluateProgramAsOf } from "../src/index";
import { resolveToCore } from "../src/resolve/index";
import { resolveStatements } from "../src/resolve/lower";
import { createEvaluationContext } from "../src/utils";
import {
  makeSingletonSchedule,
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
  makeDuration,
  makeVestingBaseVestingStart,
  makeGatedNode,
  makeVestingBaseGrantDate,
} from "./helpers";

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

// A chain head (or any ordinary statement): it carries its own FROM date.
const head = (
  amount: Amount,
  from: OCTDate,
  periodicity: VestingPeriod,
): Statement => ({
  type: "STATEMENT",
  amount,
  expr: makeSingletonSchedule(
    makeSingletonNode(makeVestingBaseDate(from)),
    periodicity,
  ),
});

// A chain head anchored on a named event (optionally offset, e.g. ipo + 12mo).
// Whether the event has fired is decided by the evaluation context, not here.
const eventHead = (
  amount: Amount,
  event: string,
  periodicity: VestingPeriod,
  offsetMonths?: number,
): Statement => ({
  type: "STATEMENT",
  amount,
  expr: makeSingletonSchedule(
    makeSingletonNode(
      makeVestingBaseEvent(event),
      offsetMonths === undefined
        ? []
        : [makeDuration(offsetMonths, "MONTHS", "PLUS")],
    ),
    periodicity,
  ),
});

// A THEN tail: it has no start of its own (vesting_start is null); the resolver
// fills in the handoff date — the moment the previous segment ended.
const then = (amount: Amount, periodicity: VestingPeriod): Statement => ({
  type: "STATEMENT",
  chained: true,
  amount,
  expr: { type: "SCHEDULE", vesting_start: null, periodicity },
});

// Accepts both compile's dated events and resolved installments; a symbolic
// installment (no date) maps to undefined.
const dates = (events: { date?: OCTDate }[]) => events.map((e) => e.date);
const installmentDates = (installments: Installment[]) =>
  installments.map((i) => (i.state === "RESOLVED" ? i.date : undefined));
const sum = (events: { amount: string }[]) =>
  events.reduce((a, e) => a + Number(e.amount), 0);
// Resolved installments carry a numeric amount, unlike compile's string output.
const total = (installments: { amount: number }[]) =>
  installments.reduce((a, t) => a + t.amount, 0);

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

describe("resolveToCore — month-end day-of-month (#34 fixed in core)", () => {
  // #34: when a chain boundary lands on a short month the handoff date gets
  // clamped — Jan 31 + 1mo is Feb 28, since February has no 31st. Core used to
  // re-anchor the rest of the chain on that clamped day and stay there. It now
  // carries the chain's origin (Jan 31) through every segment, so both policies
  // below land on the same month-end dates a single un-split schedule would.
  const janEnd: Program = [
    head(portion(1, 3), "2025-01-31", {
      type: "MONTHS",
      length: 1,
      occurrences: 1,
    }),
    then(portion(2, 3), { type: "MONTHS", length: 1, occurrences: 2 }),
  ];

  it("default policy: the chain springs back to the month-end after a Feb handoff", () => {
    const result = resolveToCore(
      janEnd,
      ctxInput({
        vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
      }),
    );
    if (result.kind !== "template") throw new Error("expected template");
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(dates(events)).toEqual(["2025-02-28", "2025-03-31", "2025-04-30"]);
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

describe("resolveToCore — month-end chain, resolve pre-pass agrees with core", () => {
  // The resolver walks the chain itself to hand each tail its start date, in
  // parallel to what core's compiler computes. Those two walks have to land on
  // the same days or a chain misbehaves. A three-segment month-end chain is the
  // smallest case that catches a drift: the head→tail1 handoff (Jan 31 + 1mo)
  // clamps to Feb 28, and it's the *next* step off Feb 28 that reveals whether
  // the day-of-month springs back to the 31st or stays stuck on the 28th.
  const monthly1 = { type: "MONTHS", length: 1, occurrences: 1 } as const;
  const janEnd3: Program = [
    head(portion(1, 3), "2025-01-31", monthly1),
    then(portion(1, 3), monthly1),
    then(portion(1, 3), monthly1),
  ];
  const defaultPolicy = ctxInput({
    vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
  });

  it("resolves each tail's start to the sprung-back day, not the clamped one", () => {
    // Reach past resolveToCore to the pre-pass itself, so this checks the
    // resolver's own cursor walk rather than the dates core ends up compiling.
    const ctx = createEvaluationContext(defaultPolicy);
    const resolutions = resolveStatements(janEnd3, ctx, ctx.grantQuantity);
    const starts = resolutions.map((r) =>
      r.start.state === "RESOLVED" ? r.start.date : null,
    );
    // tail2 lands on Mar 31, not Mar 28: the Feb 28 handoff didn't capture the
    // chain's day-of-month.
    expect(starts).toEqual(["2025-01-31", "2025-02-28", "2025-03-31"]);
  });

  it("still classifies to one template and compiles to the un-split grid", () => {
    // Springing the cursor back must not break the check that decides whether a
    // segment continues the chain; the whole thing should stay one template.
    const result = resolveToCore(janEnd3, defaultPolicy);
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.template.statements).toHaveLength(3);
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(dates(events)).toEqual(["2025-02-28", "2025-03-31", "2025-04-30"]);
  });
});

describe("chain origin day-of-month — never-clamped DAYS handoff (#171)", () => {
  // The #34 cases above all hand off on a *clamped* month-end (Jan 31 + 1mo →
  // Feb 28), which made it tempting to read the origin re-anchoring as a repair
  // for short-month clamping. It isn't: it's the policy that a grant has one
  // vesting day (the origin's), and every MONTHS segment anchors to it.
  //
  // This case has no clamp anywhere. The head is a DAYS run, so it lands on an
  // exact day count — Jan 31 + 27 days = Feb 27, nothing clamped. The MONTHS tail
  // still returns to the origin's day-of-month (31) rather than inheriting the
  // 27th the head happened to leave it on: Mar 31, Apr 30, May 31. That is the
  // ratified behavior — monthly vesting anchors schedule-wide to the commencement
  // day, not to wherever an odd-unit segment ended.
  const dsl =
    "0.25 VEST FROM DATE 2025-01-31 OVER 27 days EVERY 27 days " +
    "THEN 0.75 VEST OVER 3 months EVERY 1 month";

  it("the MONTHS tail springs to the origin's day, not the DAYS handoff", () => {
    const program = normalizeProgram(parse(dsl));
    const [schedule] = evaluateProgram(program, {
      grantDate: "2025-01-31",
      grantQuantity: 100000,
      events: {},
    });
    const installments = schedule.resolution.installments.map((i) =>
      i.state === "RESOLVED"
        ? { date: i.date, amount: i.amount }
        : { date: undefined, amount: i.amount },
    );
    expect(installments).toEqual([
      { date: "2025-02-27", amount: 25000 }, // head: exact 27-day count, unclamped
      { date: "2025-03-31", amount: 25000 }, // tail returns to day 31
      { date: "2025-04-30", amount: 25000 }, // April clamps to 30 (the calendar, not the handoff)
      { date: "2025-05-31", amount: 25000 },
    ]);
  });
});

describe("resolveToCore — a cliff on a tail measures from the handoff", () => {
  // Head vests one tranche at the first anniversary (2026-01-01); that's where
  // the tail begins. The tail carries a 12-month cliff, so its first year lumps
  // onto 2027-01-01 (handoff + 12mo) — NOT onto 2026-01-01, which is where a
  // cliff measured from the grant would have landed.
  // A vestingStart-relative duration cliff, built the same way the
  // single-statement cliff test does; for a tail, "vestingStart" is the handoff.
  const tailCliff = makeSingletonNode(makeVestingBaseVestingStart(), [
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

describe("resolveToCore — events-only month-end chain springs back too", () => {
  // The template arm already springs month-end chains back (see #34 above), but a
  // chain headed on a fired event materializes its dates on the events-only arm
  // instead, by a separate code path. That path has to spring back the same way,
  // or an event-origin chain would drift where a date chain doesn't. ipo fires on
  // a 31st, so every handoff is a candidate to clamp.
  const ctx = ctxInput({
    grantDate: "2025-01-01",
    events: { ipo: "2025-01-31" },
  });
  const program: Program = [
    eventHead(portion(1, 3), "ipo", {
      type: "MONTHS",
      length: 1,
      occurrences: 1,
    }),
    then(portion(2, 3), { type: "MONTHS", length: 1, occurrences: 2 }),
  ];

  it("materializes the month-end dates an un-split schedule would", () => {
    const result = resolveToCore(program, ctx);
    expect(result.kind).toBe("events");
    if (result.kind !== "events") return;
    // Head one month after ipo (Feb has no 31st, so Feb 28), then the tail picks
    // up and returns to the month-end: Mar 31, Apr 30 — not stuck on the 28th.
    expect(installmentDates(result.installments)).toEqual([
      "2025-02-28",
      "2025-03-31",
      "2025-04-30",
    ]);
    expect(total(result.installments)).toBe(100000);
  });
});

describe("resolveToCore — a sub-annual cliff on a month-end tail", () => {
  // A 12-month cliff preserves the day-of-month, so it never reveals drift. A
  // sub-annual cliff does: its lump fraction is "how many tranches fall before
  // the cliff", and that count has to be taken on the sprung grid the tail
  // actually vests on. If it were counted on the clamped handoff grid instead,
  // the lump would swallow one tranche too many and the amounts would be wrong.
  //
  // Head vests 1/4 at the first handoff (Jan 31 + 1mo = Feb 28). The tail runs
  // six monthly tranches from there, springing back to the month-end: Mar 31,
  // Apr 30, May 31, Jun 30, Jul 31, Aug 31. Its cliff is three months out. The
  // cliff date is a plain duration from the handoff (Feb 28 + 3mo = May 28), so
  // it lands between Apr 30 and May 31. Two tranches precede it (Mar 31, Apr 30),
  // so the lump is 2/6 of the tail and the remaining four split evenly.
  const tailCliff = makeSingletonNode(makeVestingBaseVestingStart(), [
    makeDuration(3, "MONTHS", "PLUS"),
  ]);
  const program: Program = [
    head(portion(1, 4), "2025-01-31", {
      type: "MONTHS",
      length: 1,
      occurrences: 1,
    }),
    then(portion(3, 4), {
      type: "MONTHS",
      length: 1,
      occurrences: 6,
      cliff: tailCliff,
    }),
  ];

  it("counts the pre-cliff tranches on the sprung grid, not the clamped one", () => {
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(events).toEqual([
      { date: "2025-02-28", amount: "25000" }, // head: 1/4
      { date: "2025-05-28", amount: "25000" }, // cliff lump: 2/6 of the 3/4 tail
      { date: "2025-05-31", amount: "12500" },
      { date: "2025-06-30", amount: "12500" },
      { date: "2025-07-31", amount: "12500" },
      { date: "2025-08-31", amount: "12500" },
    ]);
    expect(sum(events)).toBe(100000);
  });
});

describe("resolveToCore — split-invariance across origins and periods", () => {
  // The capstone guard for #34. Splitting a uniformly graded chain into a head and
  // a tail must not move a single date or a single share: it has to compile to
  // exactly what the same schedule written as ONE un-split statement compiles to.
  //
  // The oracle is that un-split compile, never a hand-built date array. The whole
  // bug was in core's date stepper, so checking the split chain against
  // addPeriod(origin, i, ...) would just be grading the modified stepper against
  // itself. Comparing two independent ways of asking core to lay out the same grid
  // doesn't have that blind spot.
  //
  // The matrix walks the day-of-month origins that can clamp on a short month — 29,
  // 30, 31, plus a leap-year Feb 29 — against a monthly step and a yearly (12-month)
  // step. Some cells genuinely drifted before the fix and others are controls that
  // were always fine; both have to hold now.
  //
  // Genuine drift cells:
  //   - monthly off Jan 29/30/31: the head->tail handoff clamps to Feb 28, and the
  //     pre-fix tail stayed stuck on the 28th instead of springing back.
  //   - yearly off the leap Feb 29: the day only comes back in the next leap year
  //     (2028-02-29); a pre-fix tail handed Feb 28 never recovered the 29th.
  // The rest preserve their day across the step and should sit still.
  const monthEndPolicy = {
    vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
  } as const;

  // Four uniform tranches: a one-tranche head plus a three-tranche tail, every
  // tranche an identical 1/4 of the grant. The handoff lands after tranche one —
  // mid-grid — so the tail has to re-derive its day from the (possibly clamped)
  // boundary. 100000 / 4 = 25000 divides cleanly, so no tranche rounds to zero and
  // gets dropped, which would desync the two date sequences.
  const origins: OCTDate[] = [
    "2025-01-31",
    "2025-01-30",
    "2025-01-29",
    "2024-02-29",
  ];
  const periods = [
    { label: "MONTHS", length: 1 },
    // The DSL has no YEARS unit; a year is twelve months. The case still reads
    // "YEARS" because that's the period a reviewer is thinking about.
    { label: "YEARS", length: 12 },
  ] as const;

  for (const origin of origins) {
    for (const { label, length } of periods) {
      it(`${origin} x ${label}: split chain matches its un-split equivalent`, () => {
        const split: Program = [
          head(portion(1, 4), origin, {
            type: "MONTHS",
            length,
            occurrences: 1,
          }),
          then(portion(3, 4), { type: "MONTHS", length, occurrences: 3 }),
        ];
        const unsplit: Program = [
          head(portion(1, 1), origin, {
            type: "MONTHS",
            length,
            occurrences: 4,
          }),
        ];
        const ctx = ctxInput(monthEndPolicy);
        const splitResult = resolveToCore(split, ctx);
        const unsplitResult = resolveToCore(unsplit, ctx);
        if (
          splitResult.kind !== "template" ||
          unsplitResult.kind !== "template"
        )
          throw new Error("expected templates");
        const splitEvents = compile(
          splitResult.template,
          splitResult.totalShares,
          splitResult.runtime,
        );
        const unsplitEvents = compile(
          unsplitResult.template,
          unsplitResult.totalShares,
          unsplitResult.runtime,
        );
        expect(splitEvents).toEqual(unsplitEvents);
        expect(sum(splitEvents)).toBe(100000);
      });
    }
  }
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

// A chain whose head is a named event rather than a date. The chain still steps
// forward from the event's firing, but a head and its tails are the same event
// landing on different dates, so it can't be one date template. The outcome
// depends on whether the event has fired: unresolved until it does, events-only
// once it has (with every segment still materializing).
const oneYear = { type: "MONTHS", length: 12, occurrences: 1 } as const;

describe("resolveToCore — event-origin THEN chain, event unfired", () => {
  // ipo isn't in the events map, so neither the head nor its tail has a date yet.
  const program: Program = [
    eventHead(portion(1, 2), "ipo", oneYear),
    then(portion(1, 2), oneYear),
  ];

  it("is unresolved, blocked on the unfired event", () => {
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("unresolved");
    if (result.kind !== "unresolved") return;
    expect(result.blockers).toContainEqual({
      type: "EVENT_NOT_YET_OCCURRED",
      event: "ipo",
    });
  });

  it("carries BOTH segments' share claims as symbolic installments", () => {
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("unresolved");
    if (result.kind !== "unresolved") return;
    // Head lump then tail lump, in program order; nothing is dated yet.
    expect(result.installments.map((i) => i.amount)).toEqual([50000, 50000]);
    expect(
      result.installments.every(
        (i) =>
          i.state === "UNRESOLVED" &&
          i.symbolicDate.type === "UNRESOLVED_VESTING_START",
      ),
    ).toBe(true);
    // Conservation: the whole grant is accounted for.
    expect(total(result.installments)).toBe(100000);
    // The tail's lump says what the chain waits on.
    const tail = result.installments[1];
    expect(tail.state === "UNRESOLVED" && tail.unresolved).toContain("ipo");
  });

  it("reports the head's blocker exactly once — tails don't restate it", () => {
    const result = resolveToCore(program, ctxInput());
    if (result.kind !== "unresolved") throw new Error("expected unresolved");
    expect(result.blockers).toEqual([
      { type: "EVENT_NOT_YET_OCCURRED", event: "ipo" },
    ]);
  });
});

describe("resolveToCore — multi-tail chain behind an unfired head", () => {
  const program: Program = [
    eventHead(portion(1, 2), "ipo", oneYear),
    then(portion(1, 4), oneYear),
    then(portion(1, 4), oneYear),
  ];

  it("each tail's claim survives; the blocker still appears once", () => {
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("unresolved");
    if (result.kind !== "unresolved") return;
    expect(result.installments.map((i) => i.amount)).toEqual([
      50000, 25000, 25000,
    ]);
    expect(total(result.installments)).toBe(100000);
    expect(result.blockers).toHaveLength(1);
  });
});

describe("resolveToCore — pending-head chain, tail with an event cliff (R2-B3)", () => {
  const monthly12 = { type: "MONTHS", length: 1, occurrences: 12 } as const;
  const program: Program = [
    eventHead(portion(1, 2), "ipo", monthly12),
    then(portion(1, 2), {
      ...monthly12,
      cliff: makeSingletonNode(makeVestingBaseEvent("fda")),
    }),
  ];

  it("keeps both claims and the head's blocker once; the cliff adds no blocker", () => {
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("unresolved");
    if (result.kind !== "unresolved") return;
    expect(result.installments.map((i) => i.amount)).toEqual([50000, 50000]);
    expect(total(result.installments)).toBe(100000);
    // Parity with a non-chained pending start carrying the same cliff: the start
    // gates everything before the cliff can matter, so blockers stay the head's
    // alone — the cliff's identity surfaces in the storable reason instead.
    expect(result.blockers).toEqual([
      { type: "EVENT_NOT_YET_OCCURRED", event: "ipo" },
    ]);
  });
});

describe("resolveToCore — pending-head chain, tail cliff gate is disclosed (R2-B3)", () => {
  const monthly12 = { type: "MONTHS", length: 1, occurrences: 12 } as const;
  // `vestingStart + 6 months AFTER grantDate + 6 months`: a real condition the
  // grant depends on, reportable even though the tail has no start date yet.
  const gatedCliff = makeGatedNode(
    makeVestingBaseVestingStart(),
    "AFTER",
    makeSingletonNode(makeVestingBaseGrantDate(), [
      makeDuration(6, "MONTHS", "PLUS"),
    ]),
    false,
    [makeDuration(6, "MONTHS", "PLUS")],
  );
  const program: Program = [
    eventHead(portion(1, 2), "ipo", monthly12),
    then(portion(1, 2), { ...monthly12, cliff: gatedCliff }),
  ];

  it("surfaces the gate blocker alongside the head's, each once", () => {
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("unresolved");
    if (result.kind !== "unresolved") return;
    // Before the fix the gate vanished with the zeroed cliff record.
    expect(
      result.blockers.filter((b) => b.type === "EVENT_NOT_YET_OCCURRED"),
    ).toEqual([{ type: "EVENT_NOT_YET_OCCURRED", event: "ipo" }]);
    expect(result.blockers.some((b) => b.type === "UNRESOLVED_CONDITION")).toBe(
      true,
    );
    // The tail's lump names the chain's wait; amounts are untouched.
    const tailLump = result.installments[1];
    expect(tailLump.state === "UNRESOLVED" && tailLump.unresolved).toContain(
      "ipo",
    );
    expect(total(result.installments)).toBe(100000);
  });
});

describe("resolveToCore — pending-head chain, tail duration cliff (R2-B3)", () => {
  const monthly12 = { type: "MONTHS", length: 1, occurrences: 12 } as const;
  const program: Program = [
    eventHead(portion(1, 2), "ipo", monthly12),
    then(portion(1, 2), {
      ...monthly12,
      cliff: makeSingletonNode(makeVestingBaseVestingStart(), [
        makeDuration(6, "MONTHS", "PLUS"),
      ]),
    }),
  ];

  it("pending: lowers clean — no extra blockers, both claims intact", () => {
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("unresolved");
    if (result.kind !== "unresolved") return;
    expect(result.installments.map((i) => i.amount)).toEqual([50000, 50000]);
    expect(result.blockers).toEqual([
      { type: "EVENT_NOT_YET_OCCURRED", event: "ipo" },
    ]);
  });

  it("fired: the authored cliff takes effect on the events arm", () => {
    // Once ipo fires the chain re-resolves through the live branch (anchored
    // lowerCliff), so the deferred record never outlives the firing. Head: 12
    // months from the firing. Tail: handoff 2027-06-01, 6-month cliff lumps
    // Jul–Dec onto 2027-12-01, then monthly through 2028-06-01.
    const result = resolveToCore(
      program,
      ctxInput({ events: { ipo: "2026-06-01" } }),
    );
    expect(result.kind).toBe("events");
    if (result.kind !== "events") return;
    expect(installmentDates(result.installments)).toEqual([
      ...Array.from({ length: 12 }, (_, i) =>
        addPeriod("2026-06-01", i + 1, "MONTHS"),
      ),
      "2027-12-01",
      ...Array.from({ length: 6 }, (_, i) =>
        addPeriod("2027-12-01", i + 1, "MONTHS"),
      ),
    ]);
    expect(total(result.installments)).toBe(100000);
  });
});

describe("evaluateProgramAsOf — pending chain alongside a dated sibling", () => {
  // 1/4 dated (vests 2026-01-01); a chain: 1/4 on unfired ipo THEN 1/2.
  // By the as-of the dated tranche has vested; the chain waits on ipo.
  const program: Program = [
    head(portion(1, 4), "2025-01-01", oneYear),
    eventHead(portion(1, 4), "ipo", oneYear),
    then(portion(1, 2), oneYear),
  ];

  it("tallies the whole pending chain — head AND tail — as unresolved", () => {
    const result = evaluateProgramAsOf(
      program,
      ctxInput({ asOf: "2026-06-01" }),
    );
    expect(total(result.vested)).toBe(25000); // the dated 2026-01-01 tranche
    expect(result.unvested).toEqual([]);
    expect(result.impossible).toEqual([]);
    expect(result.unresolved).toBe(75000); // 25000 head + 50000 tail
    expect(total(result.vested) + result.unresolved).toBe(100000);
  });
});

describe("resolveToCore — event-origin THEN chain, event fired", () => {
  // ipo fires on 2026-06-01. The head vests one tranche a year later, and the
  // tail picks up from there: head at ipo + 1y, tail at ipo + 2y. Both segments
  // sit on the same event, so the program resolves to events-only, not a template.
  const ctx = ctxInput({
    grantDate: "2025-01-01",
    events: { ipo: "2026-06-01" },
  });
  const program: Program = [
    eventHead(portion(1, 2), "ipo", oneYear),
    then(portion(1, 2), oneYear),
  ];

  it("classifies to events-only with every segment materialized off the event", () => {
    const result = resolveToCore(program, ctx);
    expect(result.kind).toBe("events");
    if (result.kind !== "events") return;
    expect(result.reason.kind).toBe("OVERLAPPING_ABSOLUTE_STARTS");
    // Head one year after ipo, tail two years after.
    expect(installmentDates(result.installments)).toEqual([
      "2027-06-01",
      "2028-06-01",
    ]);
    expect(total(result.installments)).toBe(100000);
  });

  it("words the overlap as a THEN chain, not an independent collision", () => {
    const result = resolveToCore(program, ctx);
    if (result.kind !== "events") throw new Error("expected events");
    if (result.reason.kind !== "OVERLAPPING_ABSOLUTE_STARTS")
      throw new Error("expected an overlapping-starts reason");
    expect(result.reason.detail).toContain("THEN chain");
    expect(result.reason.detail).toContain("promote");
  });
});

describe("resolveToCore — two independent portions, ipo and ipo + 12mo", () => {
  // These used to collide: the offset portion recorded ipo's firing at the
  // offset date, clashing with the bare portion's truthful one and forcing
  // events-only. The offset anchor now externalizes as its own synthetic event,
  // so the two coexist in one template and every recorded firing is true.
  const ctx = ctxInput({
    grantDate: "2025-01-01",
    events: { ipo: "2026-06-01" },
  });
  const program: Program = [
    eventHead(portion(1, 2), "ipo", oneYear),
    eventHead(portion(1, 2), "ipo", oneYear, 12),
  ];

  it("lowers to one template with truthful firings for both anchors", () => {
    const result = resolveToCore(program, ctx);
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.template.statements.map((s) => s.vesting_base)).toEqual([
      { type: "EVENT", event_id: "ipo" },
      { type: "EVENT", event_id: "evt:1" },
    ]);
    // No firing claims ipo happened on the offset date; the synthetic event's
    // date is the offset date by its own definition.
    expect(result.runtime.eventFirings).toEqual([
      { event_id: "ipo", date: "2026-06-01" },
      { event_id: "evt:1", date: "2027-06-01" },
    ]);
    expect(result.sourceMap["evt:1"].definition).toMatch(/ipo/);
    expect(result.sourceMap["evt:1"].definition).toMatch(/12 months/);
  });

  it("round-trips through core.compile to the dates the DSL means", () => {
    const result = resolveToCore(program, ctx);
    if (result.kind !== "template") throw new Error("expected template");
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(events.map((e) => e.date)).toEqual(["2027-06-01", "2028-06-01"]);
    expect(sum(events)).toBe(100000);
  });
});

describe("resolveToCore — THEN chain off a fired offset-event head", () => {
  // A chain headed on ipo + 12mo: the head and its tail land the same synthetic
  // anchor on different dates, the same shape as a chain off a bare event — so
  // it stays events-only rather than minting a template whose firing record
  // backdates the tail onto the named event.
  const ctx = ctxInput({
    grantDate: "2025-01-01",
    events: { ipo: "2026-06-01" },
  });
  const program: Program = [
    eventHead(portion(1, 2), "ipo", oneYear, 12),
    then(portion(1, 2), oneYear),
  ];

  it("classifies to events-only with the chain wording, dates offset-true", () => {
    const result = resolveToCore(program, ctx);
    expect(result.kind).toBe("events");
    if (result.kind !== "events") return;
    expect(result.reason.kind).toBe("OVERLAPPING_ABSOLUTE_STARTS");
    if (result.reason.kind !== "OVERLAPPING_ABSOLUTE_STARTS") return;
    expect(result.reason.detail).toContain("THEN chain");
    // Head anchored a year after ipo + 12mo, tail a year after that.
    expect(installmentDates(result.installments)).toEqual([
      "2028-06-01",
      "2029-06-01",
    ]);
    expect(total(result.installments)).toBe(100000);
  });
});

describe("resolveToCore — two event-origin chains on one fired event", () => {
  // Two separate chains, both headed on ipo, summed with PLUS. Each chain trips
  // the overlap on its own, so the program is events-only and every tail still
  // lands on the timeline.
  const ctx = ctxInput({
    grantDate: "2025-01-01",
    events: { ipo: "2026-06-01" },
  });
  const program: Program = [
    eventHead(portion(1, 4), "ipo", oneYear),
    then(portion(1, 4), oneYear),
    eventHead(portion(1, 4), "ipo", oneYear),
    then(portion(1, 4), oneYear),
  ];

  it("is events-only with the tails accounted for", () => {
    const result = resolveToCore(program, ctx);
    expect(result.kind).toBe("events");
    if (result.kind !== "events") return;
    // Both tails vest two years after ipo; the whole grant is allocated.
    expect(installmentDates(result.installments)).toContain("2028-06-01");
    expect(total(result.installments)).toBe(100000);
  });
});

describe("resolveToCore — a date chain superimposed with an independent grid", () => {
  // The chain runs 2025-01-01 -> 2026-01-01 -> 2027-01-01 (its cursor lands on
  // 2027-01-01). A second PLUS component anchored on 2025-07-01 is its own date
  // grid that doesn't continue the chain.
  const chain: Statement[] = [
    head(portion(1, 2), "2025-01-01", oneYear),
    then(portion(1, 4), oneYear),
  ];

  it("falls to events-only when the extra grid doesn't align, tails still materialize", () => {
    const program: Program = [
      ...chain,
      head(portion(1, 4), "2025-07-01", oneYear),
    ];
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("events");
    if (result.kind !== "events") return;
    expect(result.reason.kind).toBe("OVERLAPPING_ABSOLUTE_STARTS");
    // The chained tail vests at 2027-01-01 regardless of the fallout.
    expect(installmentDates(result.installments)).toContain("2027-01-01");
    expect(total(result.installments)).toBe(100000);
  });

  it("collapses to ONE template when the extra grid lands on the cursor (kept Phase 2 behavior)", () => {
    // 2027-01-01 is exactly where the chain's cursor sits, so the third
    // component merges into the chain rather than forking off to events-only.
    // Aligned collapse and superimposition are numerically identical, and the
    // template is the more useful shape, so we keep the collapse.
    const program: Program = [
      ...chain,
      head(portion(1, 4), "2027-01-01", oneYear),
    ];
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.template.statements).toHaveLength(3);
  });
});

describe("resolveToCore — pending-head chain, tail gated event cliff (R2-B14)", () => {
  const monthly12 = { type: "MONTHS", length: 1, occurrences: 12 } as const;
  const gatedEventCliff = makeGatedNode(
    makeVestingBaseEvent("fda"),
    "AFTER",
    makeSingletonNode(makeVestingBaseGrantDate(), [
      makeDuration(6, "MONTHS", "PLUS"),
    ]),
  );
  const program: Program = [
    eventHead(portion(1, 2), "ipo", monthly12),
    then(portion(1, 2), { ...monthly12, cliff: gatedEventCliff }),
  ];

  // The R2-B14 fix is interchange-reason-only; this pins that the resolution
  // surface didn't move: both claims, the head's blocker once, and the gate's
  // own blockers disclosed through cliffBlockers (per the R2-B3 convention).
  it("amounts and blockers are unchanged by the reason fix", () => {
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("unresolved");
    if (result.kind !== "unresolved") return;
    expect(result.installments.map((i) => i.amount)).toEqual([50000, 50000]);
    expect(total(result.installments)).toBe(100000);
    expect(
      result.blockers.filter(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toHaveLength(1);
    expect(
      result.blockers.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "fda",
      ),
    ).toBe(true);
    expect(result.blockers.some((b) => b.type === "UNRESOLVED_CONDITION")).toBe(
      true,
    );
  });
});
