import { describe, expect, it } from "vitest";
import { parse } from "@vestlang/dsl";
import { evaluateProgram } from "@vestlang/evaluator";
import { normalizeProgram } from "@vestlang/normalizer";
import type { ResolutionContextInput } from "@vestlang/types";
import { inferSchedule } from "../src/index.js";
import { segmentSequential } from "../src/sequential.js";
import type { TrancheInput } from "../src/types.js";

const DOM = "VESTING_START_DAY";

// A grant whose monthly rate doubles for two months and then drops back. It's one
// schedule with a rate change, not two grants — but the overlapping-train
// decomposer can only see it as two grids on top of each other.
const RATE_CHANGE: TrancheInput[] = [
  { date: "2023-12-01", amount: 100 },
  { date: "2024-01-01", amount: 100 },
  { date: "2024-02-01", amount: 200 },
  { date: "2024-03-01", amount: 200 },
  { date: "2024-04-01", amount: 100 },
  { date: "2024-05-01", amount: 100 },
];

describe("segmentSequential — forward rate-change chains", () => {
  it("splits a rate-change stream into back-to-back equal-rate segments", () => {
    const seq = segmentSequential(RATE_CHANGE, DOM);
    expect(seq).not.toBeNull();
    if (seq === null) return;

    // Three segments: 100×2, then 200×2, then 100×2, each starting where the last
    // left off.
    expect(seq.components.map((c) => c.kind)).toEqual([
      "UNIFORM",
      "UNIFORM",
      "UNIFORM",
    ]);
    expect(seq.components).toMatchObject([
      { startDate: "2023-12-01", occurrences: 2, perTrancheAmount: 100 },
      { startDate: "2024-02-01", occurrences: 2, perTrancheAmount: 200 },
      { startDate: "2024-04-01", occurrences: 2, perTrancheAmount: 100 },
    ]);

    // The first segment opens the chain; the two after it are continuations. This
    // is what Phase 3 will turn into a THEN chain.
    expect(seq.continuation).toEqual([false, true, true]);
  });

  it("recovers a cliff head that hands off to a different cadence", () => {
    // Three-month cliff (300 = 3×100 vesting at once), a monthly tail, then the
    // cadence switches to quarterly. The handoff from monthly to quarterly lands
    // on the grid, so it's still one schedule.
    const cliffThenQuarterly: TrancheInput[] = [
      { date: "2024-02-01", amount: 300 },
      { date: "2024-03-01", amount: 100 },
      { date: "2024-04-01", amount: 100 },
      { date: "2024-05-01", amount: 100 },
      { date: "2024-08-01", amount: 150 },
      { date: "2024-11-01", amount: 150 },
    ];

    const seq = segmentSequential(cliffThenQuarterly, DOM);
    expect(seq).not.toBeNull();
    if (seq === null) return;

    expect(seq.components).toMatchObject([
      {
        kind: "CLIFF_UNIFORM",
        cadence: { unit: "MONTHS", length: 1 },
        cliffSteps: 3,
        tailOccurrences: 3,
        perTrancheAmount: 100,
        // Grant date is three months before the cliff date.
        grantDate: "2023-11-01",
      },
      {
        kind: "UNIFORM",
        cadence: { unit: "MONTHS", length: 3 },
        occurrences: 2,
        perTrancheAmount: 150,
      },
    ]);
    expect(seq.continuation).toEqual([false, true]);
  });
});

describe("segmentSequential — non-chains return null", () => {
  it("declines a stream with no exact whole-share fit", () => {
    // RATE_CHANGE with the last tranche bumped by 5: the tail (100, 105) is not a
    // clean even split, so there's no rate to continue with.
    const perturbed: TrancheInput[] = [
      ...RATE_CHANGE.slice(0, 5),
      { date: "2024-05-01", amount: 105 },
    ];
    expect(segmentSequential(perturbed, DOM)).toBeNull();
  });

  it("declines two interleaved grids on different days of the month", () => {
    // Monthly on the 1st plus monthly on the 15th. After the forward cursor
    // consumes the 1st-of-month run, the 15th-of-month tranches are stranded
    // behind it — no single forward schedule threads both.
    const interleaved: TrancheInput[] = [
      { date: "2024-02-01", amount: 100 },
      { date: "2024-02-15", amount: 50 },
      { date: "2024-03-01", amount: 100 },
      { date: "2024-03-15", amount: 50 },
      { date: "2024-04-01", amount: 100 },
      { date: "2024-04-15", amount: 50 },
      { date: "2024-05-01", amount: 100 },
      { date: "2024-05-15", amount: 50 },
    ];
    expect(segmentSequential(interleaved, DOM)).toBeNull();
  });

  it("declines a plain single train (the ordinary decomposer already finds it)", () => {
    const flat: TrancheInput[] = [
      { date: "2024-02-01", amount: 100 },
      { date: "2024-03-01", amount: 100 },
      { date: "2024-04-01", amount: 100 },
      { date: "2024-05-01", amount: 100 },
    ];
    expect(segmentSequential(flat, DOM)).toBeNull();
  });
});

describe("inferSchedule — sequential recovery end to end", () => {
  it("turns a rate-change stream into a single template", () => {
    const inferred = inferSchedule({ tranches: RATE_CHANGE });
    expect(inferred.diagnostics.residualError).toBeLessThan(1e-6);
    expect(inferred.decomposition.uniforms.length).toBe(3);

    // The segments are written as one schedule (THEN), not as separate dated
    // grants (PLUS): the head carries the start, the continuations don't.
    expect(inferred.dsl).toContain("THEN");
    expect(inferred.dsl).not.toContain("PLUS");

    // Collapse the emitted DSL the way a consumer would and confirm the program
    // reads as one reusable template, not a flat events-only list.
    const program = normalizeProgram(parse(inferred.dsl));
    const ctx: ResolutionContextInput = {
      grantDate: RATE_CHANGE[0].date,
      events: {},
      grantQuantity: 800,
      vesting_day_of_month: inferred.diagnostics.vestingDayOfMonth,
    };
    const schedule = evaluateProgram(program, ctx);
    expect(schedule.resolution.status).toBe("template");
  });

  it("emits a head followed by chained tails, never the other way round", () => {
    // The renderer reads a chain off the flat statement list by looking for the
    // first un-chained statement and treating the chained ones after it as its
    // continuation. So the head must come first and every later segment must be
    // chained — that's the shape THEN encoding depends on.
    const program = normalizeProgram(
      parse(inferSchedule({ tranches: RATE_CHANGE }).dsl),
    );
    expect(program.map((s) => s.chained ?? false)).toEqual([false, true, true]);
  });

  it("renders a cliff head handing off to a chained tail", () => {
    // The cliff (head, with its own start) is followed by a THEN tail at a new
    // cadence — one schedule, not a cliff grant plus a separate quarterly grant.
    //
    // Amounts give each segment a terminating share of the total (800): head
    // 600/800 = 3/4, tail 200/800 = 1/4, cliff lump 300/600 = 1/2. Percentages
    // store as truncated Numeric decimals, so a repeating split would lose a
    // share and the chain would fall back to a dated PLUS list instead of
    // CLIFF/THEN.
    const cliffThenQuarterly: TrancheInput[] = [
      { date: "2024-02-01", amount: 300 },
      { date: "2024-03-01", amount: 100 },
      { date: "2024-04-01", amount: 100 },
      { date: "2024-05-01", amount: 100 },
      { date: "2024-08-01", amount: 100 },
      { date: "2024-11-01", amount: 100 },
    ];
    const inferred = inferSchedule({
      tranches: cliffThenQuarterly,
      grantDate: "2023-11-01",
    });
    expect(inferred.dsl).toContain("CLIFF");
    expect(inferred.dsl).toContain("THEN");
    expect(inferred.dsl).not.toContain("PLUS");
  });
});

describe("inferSchedule — THEN survives month-end clamping", () => {
  // A monthly rate change where the handoff lands on February. The head ends on a
  // 31st-of-the-month grid, so its next slot springs back to Feb 29; the rate then
  // doubles. This is the case THEN exists for: written as a dated PLUS list the
  // tail would carry an explicit start that the clamping pushes a day off the
  // running grid, breaking the schedule into two; written as THEN the tail has no
  // date of its own and just continues the grid.
  // Amounts give each segment a terminating share of the total (600): head
  // 150/600 = 1/4, tail 450/600 = 3/4. Percentages store as truncated Numeric
  // decimals, so a repeating split (the original 1/3 + 2/3) would lose a share
  // and the THEN chain wouldn't round-trip.
  const MONTH_END: TrancheInput[] = [
    { date: "2023-12-31", amount: 75 },
    { date: "2024-01-31", amount: 75 },
    { date: "2024-02-29", amount: 225 },
    { date: "2024-03-31", amount: 225 },
  ];
  const GRANT = "2023-11-30";

  function collapse(dsl: string, dom: string) {
    const ctx: ResolutionContextInput = {
      grantDate: GRANT,
      events: {},
      grantQuantity: 600,
      vesting_day_of_month:
        dom as ResolutionContextInput["vesting_day_of_month"],
    };
    return evaluateProgram(normalizeProgram(parse(dsl)), ctx);
  }

  it("recovers the stream as one template", () => {
    const inferred = inferSchedule({ tranches: MONTH_END, grantDate: GRANT });
    expect(inferred.diagnostics.residualError).toBeLessThan(1e-6);
    expect(inferred.dsl).toContain("THEN");
    expect(
      collapse(inferred.dsl, inferred.diagnostics.vestingDayOfMonth).resolution
        .status,
    ).toBe("template");
  });

  it("the equivalent dated PLUS list cannot be one template", () => {
    // What the inferrer would have emitted before THEN encoding: the tail's start
    // is computed by stepping one month back from its first installment (Feb 29 →
    // Jan 29), which no longer lines up with the head's grid (Jan 31). The two
    // statements read as independent grids → events-only.
    const dated =
      "150 VEST FROM DATE 2023-12-31 OVER 2 months EVERY 1 month PLUS 450 VEST FROM DATE 2024-01-29 OVER 2 months EVERY 1 month";
    expect(collapse(dated, "LAST_DAY_OF_MONTH").resolution.status).toBe(
      "events-only",
    );
  });
});
