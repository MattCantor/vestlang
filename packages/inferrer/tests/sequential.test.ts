import { describe, expect, it } from "vitest";
import { parse } from "@vestlang/dsl";
import { evaluateProgram } from "@vestlang/evaluator";
import { normalizeProgram } from "@vestlang/normalizer";
import type { EvaluationContextInput } from "@vestlang/types";
import { inferSchedule } from "../src/index.js";
import { segmentSequential } from "../src/sequential.js";
import type { TrancheInput } from "../src/types.js";

const DOM = "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH";

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

    // Collapse the emitted DSL the way a consumer would and confirm the program
    // reads as one reusable template, not a flat events-only list.
    const program = normalizeProgram(parse(inferred.dsl));
    const ctx: EvaluationContextInput = {
      events: { grantDate: RATE_CHANGE[0].date },
      grantQuantity: 800,
      asOf: "2030-01-01",
      vesting_day_of_month: inferred.diagnostics.vestingDayOfMonth,
    };
    const [schedule] = evaluateProgram(program, ctx);
    expect(schedule.status).toBe("template");
  });
});
