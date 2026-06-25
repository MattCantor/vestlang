// THEN chains: a head plus one or more tails, where each tail picks up the
// timeline exactly where the previous segment ended. A date-origin chain should
// classify to a single `template`, and its dates must match what core's compiler
// produces for the same schedule — that equivalence is what these tests pin.

import { describe, it, expect } from "vitest";
import { compile } from "@vestlang/core";
import { addPeriod } from "@vestlang/primitives";
import { CONTINGENT_START_SENTINEL } from "@vestlang/utils";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import type {
  Amount,
  AsOfContextInput,
  Installment,
  OCTDate,
  Program,
  Statement,
  VestingNodeExpr,
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
// The resolved tranches only — symbolic/pending installments dropped, not mapped to
// undefined (unlike `installmentDates`). `datedTranches` keeps date + amount,
// `datedDates` just the dates; both used by the #412 fold tests.
const datedTranches = (installments: Installment[]) =>
  installments.flatMap((i) =>
    i.state === "RESOLVED" ? [{ date: i.date, amount: i.amount }] : [],
  );
const datedDates = (installments: Installment[]) =>
  installments.flatMap((i) => (i.state === "RESOLVED" ? [i.date] : []));
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
    const ctx = createEvaluationContext(defaultPolicy, "resolution");
    const resolutions = resolveStatements(janEnd3, ctx);
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
    const schedule = evaluateProgram(program, {
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

describe("resolveToCore — single-event-head month-end chain springs back too", () => {
  // A chain headed on ONE event is a single contingent origin, so once that event
  // fires it's a `template` whose DATE statements chain off the resolved start —
  // and the chain has to spring month-end handoffs back the same way a date chain
  // does (see #34 above), or it would drift. ipo fires on a 31st, so every handoff
  // is a candidate to clamp.
  const ctx = ctxInput({
    grantDate: "2025-01-01",
    events: { ipo: "2025-01-31" },
  });
  // Terminating shares (1/4, 3/4): a fired-event THEN chain lowers to one
  // canonical template, so each percentage stores as a Numeric decimal. A
  // repeating share (1/3) would truncate and drop a share off the total; the
  // dates this test pins are unaffected by the split, so terminating shares keep
  // the conservation check clean while still exercising the month-end springing.
  const program: Program = [
    eventHead(portion(1, 4), "ipo", {
      type: "MONTHS",
      length: 1,
      occurrences: 1,
    }),
    then(portion(3, 4), { type: "MONTHS", length: 1, occurrences: 2 }),
  ];

  it("materializes the month-end dates an un-split schedule would", () => {
    const result = resolveToCore(program, ctx);
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    // The fired event start dates the whole chain off the resolved date; compile
    // the template to read the projection.
    const events = compile(result.template, result.totalShares, result.runtime);
    // Head one month after ipo (Feb has no 31st, so Feb 28), then the tail picks
    // up and returns to the month-end: Mar 31, Apr 30 — not stuck on the 28th.
    expect(events.map((e) => e.date)).toEqual([
      "2025-02-28",
      "2025-03-31",
      "2025-04-30",
    ]);
    expect(events.reduce((s, e) => s + Number(e.amount), 0)).toBe(100000);
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
      // Cliff lump: 2/6 = 1/3 of the 3/4 tail. The cliff percentage stores as the
      // truncated Numeric "0.3333333333", so floor(0.3333333333 × 75000) = 24999
      // rather than the exact 25000 — the precision loss the Numeric storage
      // introduces. The remainder telescopes through the tail (the final tranche
      // picks up the missing share), so the total still lands on 100000.
      { date: "2025-05-28", amount: "24999" },
      { date: "2025-05-31", amount: "12500" },
      { date: "2025-06-30", amount: "12500" },
      { date: "2025-07-31", amount: "12500" },
      { date: "2025-08-31", amount: "12501" },
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
  // Terminating shares (1/4, 3/4) so the chain's canonical template stores both
  // percentages exactly — a repeating 1/3 would truncate and lose a share off the
  // conservation total this test checks; the dates don't depend on the split.
  const program: Program = [
    head(portion(1, 4), "2025-01-01", {
      type: "MONTHS",
      length: 0,
      occurrences: 1,
    }),
    then(portion(3, 4), { type: "MONTHS", length: 12, occurrences: 2 }),
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
  // A chain headed on ONE event is a single contingent origin, so it is now a
  // storable `template` (sentinel start + evt:start recipe), carrying its share
  // claims as symbolic pending installments until the event fires.
  const program: Program = [
    eventHead(portion(1, 2), "ipo", oneYear),
    then(portion(1, 2), oneYear),
  ];

  it("is a contingent template, blocked on the unfired event", () => {
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(Object.keys(result.sourceMap)).toEqual(["evt:start"]);
    expect(result.blockers).toContainEqual({
      type: "EVENT_NOT_YET_OCCURRED",
      event: "ipo",
    });
  });

  it("carries BOTH segments' share claims as symbolic installments", () => {
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    // Head lump then tail lump, in program order; nothing is dated yet, so both
    // ride the pending channel.
    expect(result.pendingInstallments.map((i) => i.amount)).toEqual([
      50000, 50000,
    ]);
    expect(
      result.pendingInstallments.every(
        (i) => i.symbolicDate.type === "UNRESOLVED_VESTING_START",
      ),
    ).toBe(true);
    // Conservation: the whole grant is accounted for.
    expect(result.pendingInstallments.reduce((s, i) => s + i.amount, 0)).toBe(
      100000,
    );
  });

  it("reports the head's blocker exactly once — tails don't restate it", () => {
    const result = resolveToCore(program, ctxInput());
    if (result.kind !== "template") throw new Error("expected template");
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
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.pendingInstallments.map((i) => i.amount)).toEqual([
      50000, 25000, 25000,
    ]);
    expect(result.pendingInstallments.reduce((s, i) => s + i.amount, 0)).toBe(
      100000,
    );
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

  it("→ compound template: contingent start + the tail's event_condition", () => {
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    // The chain is headed on one contingent event start; the tail carries the
    // cliff's event_condition (fda). Both halves store.
    expect(result.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(result.template.statements[1].event_condition).toEqual({
      event_id: "fda",
    });
    expect(result.pendingInstallments.reduce((s, i) => s + i.amount, 0)).toBe(
      100000,
    );
    // Both contingencies are disclosed.
    const pendingEvents = result.blockers.flatMap((b) =>
      b.type === "EVENT_NOT_YET_OCCURRED" ? [b.event] : [],
    );
    expect(pendingEvents).toContain("ipo");
    expect(pendingEvents).toContain("fda");
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
    // The tail's gate is on a `vestingStart + 6 months` time cliff (no event), so
    // it does NOT become an event_condition — it's a deferred gated time cliff that
    // can't be placed without the start, so it keeps the program unresolved and
    // surfaces its gate's condition (unchanged from pre-#255).
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("unresolved");
    if (result.kind !== "unresolved") return;
    expect(
      result.blockers.filter((b) => b.type === "EVENT_NOT_YET_OCCURRED"),
    ).toEqual([{ type: "EVENT_NOT_YET_OCCURRED", event: "ipo" }]);
    expect(result.blockers.some((b) => b.type === "UNRESOLVED_CONDITION")).toBe(
      true,
    );
    const tailLump = result.installments[1];
    expect(tailLump.state).toBe("UNRESOLVED");
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

  it("pending: a contingent template — no extra blockers, both claims intact", () => {
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(result.pendingInstallments.map((i) => i.amount)).toEqual([
      50000, 50000,
    ]);
    expect(result.blockers).toEqual([
      { type: "EVENT_NOT_YET_OCCURRED", event: "ipo" },
    ]);
  });

  it("fired: the chain re-anchors off the resolved start, cliff and all", () => {
    // Once ipo fires the chain re-resolves to a dated template off the resolved
    // start. Head: 12 months from the firing. Tail: handoff 2027-06-01, 6-month
    // cliff lumps Jul–Dec onto 2027-12-01, then monthly through 2028-06-01.
    const result = resolveToCore(
      program,
      ctxInput({ events: { ipo: "2026-06-01" } }),
    );
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(events.map((e) => e.date)).toEqual([
      ...Array.from({ length: 12 }, (_, i) =>
        addPeriod("2026-06-01", i + 1, "MONTHS"),
      ),
      "2027-12-01",
      ...Array.from({ length: 6 }, (_, i) =>
        addPeriod("2027-12-01", i + 1, "MONTHS"),
      ),
    ]);
    expect(events.reduce((s, e) => s + Number(e.amount), 0)).toBe(100000);
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
  // ipo fires on 2026-06-01. A chain headed on ONE event is a single contingent
  // origin, so once fired it re-anchors off the resolved start as a dated
  // `template`: head at ipo + 1y, tail at ipo + 2y (no longer events-only — the
  // single-origin chain now promotes).
  const ctx = ctxInput({
    grantDate: "2025-01-01",
    events: { ipo: "2026-06-01" },
  });
  const program: Program = [
    eventHead(portion(1, 2), "ipo", oneYear),
    then(portion(1, 2), oneYear),
  ];

  it("resolves to a dated template, every segment off the resolved start", () => {
    const result = resolveToCore(program, ctx);
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    const events = compile(result.template, result.totalShares, result.runtime);
    // Head one year after ipo, tail two years after.
    expect(events.map((e) => e.date)).toEqual(["2027-06-01", "2028-06-01"]);
    expect(events.reduce((s, e) => s + Number(e.amount), 0)).toBe(100000);
  });
});

describe("resolveToCore — two portions, ipo and ipo + 12mo (aligned collapse)", () => {
  // Both fired: `EVENT ipo` resolves its start to 2026-06-01 and its lone
  // 12-month occurrence to 2027-06-01 — exactly where `EVENT ipo + 12 months`
  // starts. The second portion's start lands on the first chain's cursor, so the
  // two resolved date grids collapse into ONE template (the same aligned-collapse
  // the dated-grid case keeps). Every recorded date is true.
  const ctx = ctxInput({
    grantDate: "2025-01-01",
    events: { ipo: "2026-06-01" },
  });
  const program: Program = [
    eventHead(portion(1, 2), "ipo", oneYear),
    eventHead(portion(1, 2), "ipo", oneYear, 12),
  ];

  it("collapses to one dated template (no sidecar — both starts are dated)", () => {
    const result = resolveToCore(program, ctx);
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.runtime.startDate).toBe("2026-06-01");
    expect(result.sourceMap).toEqual({});
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
  // A chain headed on `ipo + 12mo` is a single contingent origin (one offset-event
  // start), so once fired it re-anchors off the resolved offset date as a dated
  // `template` — the head and tail chain, no longer events-only.
  const ctx = ctxInput({
    grantDate: "2025-01-01",
    events: { ipo: "2026-06-01" },
  });
  const program: Program = [
    eventHead(portion(1, 2), "ipo", oneYear, 12),
    then(portion(1, 2), oneYear),
  ];

  it("resolves to a dated template, dates offset-true", () => {
    const result = resolveToCore(program, ctx);
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    const events = compile(result.template, result.totalShares, result.runtime);
    // Head anchored a year after ipo + 12mo, tail a year after that.
    expect(events.map((e) => e.date)).toEqual(["2028-06-01", "2029-06-01"]);
    expect(events.reduce((s, e) => s + Number(e.amount), 0)).toBe(100000);
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

  // Under #255 a gated EVENT cliff on the tail → a synthetic event_condition (the
  // gate captured in its recipe), and the chain is headed on one contingent event
  // start, so the whole thing is a COMPOUND template.
  it("→ compound template: contingent start + a synthetic event_condition on the tail", () => {
    const result = resolveToCore(program, ctxInput());
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(result.template.statements[1].event_condition?.event_id).toMatch(
      /^evt:\d+$/,
    );
    expect(result.pendingInstallments.reduce((s, i) => s + i.amount, 0)).toBe(
      100000,
    );
    // The start's blocker is disclosed.
    expect(
      result.blockers.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
  });
});

// #412 — a THEN tail must not vest before its head's grid releases. When the head
// carries an unfired event cliff (`CLIFF EVENT ipo`), the head's grid is HELD: it
// folds at the firing (or at max(cliff floor, firing)). A tail behind it can't be
// dated off the head's bare grid end — that put the second half of the grant on the
// timeline months before the first half released. The fix folds the chain handoff:
// an unfired held head hands off nothing (the tail pends), a fired one re-anchors at
// max(bareGridEnd, foldPoint).
describe("resolveToCore — THEN tail behind a held-cliff head (#412)", () => {
  const fourMonths = { type: "MONTHS", length: 1, occurrences: 4 } as const;
  // 0.5 OVER 4mo CLIFF EVENT ipo  THEN  0.5 OVER 4mo. Grant 800 → 400 / 400.
  const heldHeadChain = (): Program => [
    head(portion(1, 2), "2024-01-01", {
      ...fourMonths,
      cliff: makeSingletonNode(makeVestingBaseEvent("ipo")),
    }),
    then(portion(1, 2), fourMonths),
  ];
  const ctx = (events: Record<string, OCTDate> = {}) =>
    ctxInput({ grantDate: "2024-01-01", grantQuantity: 800, events });

  it("UNFIRED head → the tail is pending, not dated", () => {
    // No firing: the head's grid is held, so the tail can't be placed at all. It
    // must NOT date 2024-06..09 (the old bug); it pends, waiting on ipo.
    const result = resolveToCore(heldHeadChain(), ctx());
    expect(result.kind).toBe("unresolved");
    if (result.kind !== "unresolved") return;
    // Nothing dated leaks out before the hold clears.
    expect(
      installmentDates(result.installments).every((d) => d === undefined),
    ).toBe(true);
    // The tail discloses what it waits on — the head's real event.
    expect(result.blockers).toContainEqual({
      type: "EVENT_NOT_YET_OCCURRED",
      event: "ipo",
    });
    // Conservation: both halves still accounted for (400 head + 400 tail).
    expect(total(result.installments)).toBe(800);
  });

  it("LATE firing → the tail re-anchors at the fold point, never before it", () => {
    // ipo fires 2025-12-01, ~18 months after the head's bare grid end (2024-05-01).
    // The head's 400 folds onto 2025-12-01; the tail must start AFTER that, so its
    // first tranche is 2026-01-01 — not 2024-06-01. foldPoint wins the max.
    const result = resolveToCore(heldHeadChain(), ctx({ ipo: "2025-12-01" }));
    expect(result.kind).toBe("events");
    if (result.kind !== "events") return;
    const dated = datedTranches(result.installments);
    expect(dated).toEqual([
      { date: "2025-12-01", amount: 400 }, // the head's held grid, folded
      { date: "2026-01-01", amount: 100 },
      { date: "2026-02-01", amount: 100 },
      { date: "2026-03-01", amount: 100 },
      { date: "2026-04-01", amount: 100 },
    ]);
    // No tail tranche precedes the head's fold — the inversion is gone.
    expect(dated.slice(1).every((t) => t.date >= "2025-12-01")).toBe(true);
    expect(total(result.installments)).toBe(800);
  });

  it("EARLY firing under a LONG head → tail still chains off the bare grid end (no regression)", () => {
    // 24-month head, ipo fires early (2024-06-01). The bare grid end (2026-01-01)
    // is LATER than the fold point (2024-06-01), so the bare end wins the max and
    // the chain stays a single dated template — exactly as before #412. A blanket
    // fold-point re-anchor would wrongly pull the tail back to mid-2024.
    const program: Program = [
      head(portion(1, 2), "2024-01-01", {
        type: "MONTHS",
        length: 1,
        occurrences: 24,
        cliff: makeSingletonNode(makeVestingBaseEvent("ipo")),
      }),
      then(portion(1, 2), { type: "MONTHS", length: 1, occurrences: 4 }),
    ];
    const result = resolveToCore(program, ctx({ ipo: "2024-06-01" }));
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    const events = compile(result.template, result.totalShares, result.runtime);
    const dated = events.map((e) => e.date);
    // The head runs through 2026-01-01; the tail's four tranches follow, the first
    // at 2026-02-01 — unchanged from the pre-#412 behaviour.
    expect(dated.slice(-4)).toEqual([
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
    ]);
    expect(events.reduce((s, e) => s + Number(e.amount), 0)).toBe(800);
  });

  it("TIME-baseline cliff floor wins the fold point over an early firing", () => {
    // CLIFF LATER OF(vestingStart + 12 months, EVENT ipo) on a 24-month head, ipo
    // fired early (2024-03-01). The fold point is max(cliffDate 2025-01-01, firing
    // 2024-03-01) = the 12-month floor. The head's grid still ends 2026-01-01 (the
    // bare end beats the floor), so the chain stays one template; the floor folds
    // the head's pre-cliff tranches onto 2025-01-01.
    const cliff: VestingNodeExpr<"VESTING_START"> = {
      type: "NODE_LATER_OF",
      items: [
        makeSingletonNode(makeVestingBaseVestingStart(), [
          makeDuration(12, "MONTHS", "PLUS"),
        ]),
        makeSingletonNode(makeVestingBaseEvent("ipo")),
      ],
    };
    const program: Program = [
      head(portion(1, 2), "2024-01-01", {
        type: "MONTHS",
        length: 1,
        occurrences: 24,
        cliff,
      }),
      then(portion(1, 2), { type: "MONTHS", length: 1, occurrences: 4 }),
    ];
    const result = resolveToCore(program, ctx({ ipo: "2024-03-01" }));
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    const events = compile(result.template, result.totalShares, result.runtime);
    // The head's pre-cliff accrual folds onto the 12-month floor.
    expect(events[0].date).toBe("2025-01-01");
    // The tail's four tranches still follow the head's grid end (2026-01-01).
    expect(events.map((e) => e.date).slice(-4)).toEqual([
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
    ]);
    expect(events.reduce((s, e) => s + Number(e.amount), 0)).toBe(800);
  });

  it("day-of-month preserved through the re-anchor", () => {
    // The chain origin sits on the 31st (head FROM 2024-01-31). After the late
    // firing folds the head onto the firing date (day 1), the re-anchored tail must
    // grid on the origin's day-of-month (the 31st, clamped per month) — NOT on the
    // fold date's day. This is what proves the re-anchor steps off the origin, not
    // the fold date.
    const program: Program = [
      head(portion(1, 2), "2024-01-31", {
        ...fourMonths,
        cliff: makeSingletonNode(makeVestingBaseEvent("ipo")),
      }),
      then(portion(1, 2), fourMonths),
    ];
    const result = resolveToCore(
      program,
      ctxInput({
        grantDate: "2024-01-01",
        grantQuantity: 800,
        events: { ipo: "2025-12-01" },
      }),
    );
    expect(result.kind).toBe("events");
    if (result.kind !== "events") return;
    const dated = datedDates(result.installments);
    // Head folds on the firing (2025-12-01); the tail grids on the origin's day —
    // the 31st, clamping onto each month's last day — re-anchored after the fold.
    expect(dated).toEqual([
      "2025-12-01",
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
    expect(total(result.installments)).toBe(800);
  });

  it("MULTI-segment: the hold propagates through every downstream tail", () => {
    // 0.4 CLIFF EVENT ipo THEN 0.3 THEN 0.3. Grant 1000 → 400 / 300 / 300.
    const multi = (): Program => [
      head(portion(4, 10), "2024-01-01", {
        ...fourMonths,
        cliff: makeSingletonNode(makeVestingBaseEvent("ipo")),
      }),
      then(portion(3, 10), fourMonths),
      then(portion(3, 10), fourMonths),
    ];

    // Unfired: BOTH tails pend (neither dated), blocker disclosed once.
    const unfired = resolveToCore(
      multi(),
      ctxInput({ grantDate: "2024-01-01", grantQuantity: 1000 }),
    );
    expect(unfired.kind).toBe("unresolved");
    if (unfired.kind !== "unresolved") return;
    expect(
      installmentDates(unfired.installments).every((d) => d === undefined),
    ).toBe(true);
    expect(total(unfired.installments)).toBe(1000);

    // Late firing: tail1 re-anchors after the fold, tail2 continues off tail1.
    const fired = resolveToCore(
      multi(),
      ctxInput({
        grantDate: "2024-01-01",
        grantQuantity: 1000,
        events: { ipo: "2025-12-01" },
      }),
    );
    expect(fired.kind).toBe("events");
    if (fired.kind !== "events") return;
    const dated = datedTranches(fired.installments);
    expect(dated).toEqual([
      { date: "2025-12-01", amount: 400 }, // head folded
      { date: "2026-01-01", amount: 75 }, // tail1
      { date: "2026-02-01", amount: 75 },
      { date: "2026-03-01", amount: 75 },
      { date: "2026-04-01", amount: 75 },
      { date: "2026-05-01", amount: 75 }, // tail2 continues off tail1's end
      { date: "2026-06-01", amount: 75 },
      { date: "2026-07-01", amount: 75 },
      { date: "2026-08-01", amount: 75 },
    ]);
    // No tail tranche precedes the head's fold.
    expect(dated.slice(1).every((t) => t.date >= "2025-12-01")).toBe(true);
    expect(total(fired.installments)).toBe(1000);
  });
});

// #412 Decision A — the inversion when the held cliff is on an intermediate TAIL,
// not the head. A dated head hands off to a tail whose OWN cliff is an unfired
// event hold; a later tail must not date off that held tail's grid end either.
describe("resolveToCore — THEN tail behind a held-cliff TAIL (#412 Decision A)", () => {
  const fourMonths = { type: "MONTHS", length: 1, occurrences: 4 } as const;
  // 0.4 (dated head) THEN 0.3 CLIFF EVENT ipo THEN 0.3. Grant 1000 → 400/300/300.
  const chain = (): Program => [
    head(portion(4, 10), "2024-01-01", fourMonths),
    then(portion(3, 10), {
      ...fourMonths,
      cliff: makeSingletonNode(makeVestingBaseEvent("ipo")),
    }),
    then(portion(3, 10), fourMonths),
  ];

  it("UNFIRED tail cliff → the dated head vests, the second tail pends behind the held tail", () => {
    const result = resolveToCore(
      chain(),
      ctxInput({ grantDate: "2024-01-01", grantQuantity: 1000 }),
    );
    // The held tail folds the handoff to PENDING, so the chain can't be one
    // template; it's unresolved with the dated head's tranches alongside the
    // pending remainder.
    expect(result.kind).toBe("unresolved");
    if (result.kind !== "unresolved") return;
    // The dated head still materializes (2024-02..05); the held tail + the tail
    // behind it ride symbolically.
    expect(datedDates(result.installments)).toEqual([
      "2024-02-01",
      "2024-03-01",
      "2024-04-01",
      "2024-05-01",
    ]);
    expect(result.blockers).toContainEqual({
      type: "EVENT_NOT_YET_OCCURRED",
      event: "ipo",
    });
    expect(total(result.installments)).toBe(1000);
  });

  it("LATE firing → the held tail folds, the tail behind it re-anchors after the fold", () => {
    const result = resolveToCore(
      chain(),
      ctxInput({
        grantDate: "2024-01-01",
        grantQuantity: 1000,
        events: { ipo: "2025-12-01" },
      }),
    );
    expect(result.kind).toBe("events");
    if (result.kind !== "events") return;
    const dated = datedTranches(result.installments);
    expect(dated).toEqual([
      { date: "2024-02-01", amount: 100 }, // dated head, 400 over 4mo
      { date: "2024-03-01", amount: 100 },
      { date: "2024-04-01", amount: 100 },
      { date: "2024-05-01", amount: 100 },
      { date: "2025-12-01", amount: 300 }, // held tail folds on the firing
      { date: "2026-01-01", amount: 75 }, // last tail re-anchors after the fold
      { date: "2026-02-01", amount: 75 },
      { date: "2026-03-01", amount: 75 },
      { date: "2026-04-01", amount: 75 },
    ]);
    // The last tail never precedes the held tail's fold.
    expect(dated.slice(5).every((t) => t.date >= "2025-12-01")).toBe(true);
    expect(total(result.installments)).toBe(1000);
  });
});

// #412 — a SYNTHETIC (multi-event) held cliff on the head, at the RESOLUTION level.
// The head holds on `LATER OF(EVENT a, EVENT b)`, which lowers to a synthetic
// event side (no single nameable event). The pending tail must surface the REAL
// underlying events `a`/`b` (the selector tree), never the minted `evt:<n>` id — the
// disclosure unresolved.ts now sources from the held cliff's own blockers. Once both
// fire, the head folds onto the later of them and the tail re-anchors after the fold.
describe("resolveToCore — THEN tail behind a SYNTHETIC held-cliff head (#412)", () => {
  const fourMonths = { type: "MONTHS", length: 1, occurrences: 4 } as const;
  const syntheticCliff: VestingNodeExpr<"VESTING_START"> = {
    type: "NODE_LATER_OF",
    items: [
      makeSingletonNode(makeVestingBaseEvent("a")),
      makeSingletonNode(makeVestingBaseEvent("b")),
    ],
  };
  // 1/2 OVER 4mo CLIFF LATER OF(EVENT a, EVENT b)  THEN  1/2 OVER 4mo. 800 → 400/400.
  const chain = (): Program => [
    head(portion(1, 2), "2024-01-01", { ...fourMonths, cliff: syntheticCliff }),
    then(portion(1, 2), fourMonths),
  ];
  const ctx = (events: Record<string, OCTDate> = {}) =>
    ctxInput({ grantDate: "2024-01-01", grantQuantity: 800, events });

  it("UNFIRED a/b → the pending tail surfaces the REAL events, no synthetic id", () => {
    const result = resolveToCore(chain(), ctx());
    expect(result.kind).toBe("unresolved");
    if (result.kind !== "unresolved") return;
    // The disclosed blocker is the real selector tree over a/b — not a minted
    // `evt:<n>`, and not an EVENT_CHAINED_TAIL (that path needs a single named event).
    const rendered = JSON.stringify(result.blockers);
    expect(rendered).toContain('"event":"a"');
    expect(rendered).toContain('"event":"b"');
    expect(rendered).toContain("UNRESOLVED_SELECTOR");
    expect(rendered).not.toContain("evt:");
    expect(rendered).not.toContain("EVENT_CHAINED_TAIL");
    // Conservation: nothing dated leaks before the hold clears; both halves survive.
    expect(
      installmentDates(result.installments).every((d) => d === undefined),
    ).toBe(true);
    expect(total(result.installments)).toBe(800);
  });

  it("BOTH fired → the head folds on the later event, the tail re-anchors after it", () => {
    // a fires 2025-03-01, b fires 2025-06-01; the LATER OF folds onto 2025-06-01.
    const result = resolveToCore(
      chain(),
      ctx({ a: "2025-03-01", b: "2025-06-01" }),
    );
    expect(result.kind).toBe("events");
    if (result.kind !== "events") return;
    expect(datedTranches(result.installments)).toEqual([
      { date: "2025-06-01", amount: 400 }, // head folds on max(a, b)
      { date: "2025-07-01", amount: 100 }, // tail re-anchors at max(bareEnd, 2025-06-01)
      { date: "2025-08-01", amount: 100 },
      { date: "2025-09-01", amount: 100 },
      { date: "2025-10-01", amount: 100 },
    ]);
    expect(total(result.installments)).toBe(800);
  });
});
