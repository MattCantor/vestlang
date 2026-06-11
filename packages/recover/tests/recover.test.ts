import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import type { EvaluationContextInput } from "@vestlang/types";
import { describe, expect, it } from "vitest";
import { evaluateProgramWithRecovery } from "../src/recover.js";

const prog = (dsl: string) => normalizeProgram(parse(dsl));

function makeCtx(opts: {
  grantQuantity: number;
  events?: Record<string, string>;
}): EvaluationContextInput {
  return {
    grantDate: "2024-01-01",
    events: { ...(opts.events ?? {}) },
    grantQuantity: opts.grantQuantity,
    asOf: "2025-01-01",
  };
}

describe("evaluateProgramWithRecovery", () => {
  // The #43 case: two overlapping absolute-date grids the classifier calls
  // events-only, whose 100,100,200,200,100,100 projection has an equivalent
  // single THEN-chain template.
  it("rescues overlapping absolute-date grids into a THEN-chain template", () => {
    const outcome = evaluateProgramWithRecovery(
      prog(
        "0.5 VEST FROM DATE 2024-01-01 OVER 4 months EVERY 1 month PLUS 0.5 VEST FROM DATE 2024-03-01 OVER 4 months EVERY 1 month",
      ),
      makeCtx({ grantQuantity: 800 }),
    );

    expect(outcome.rescued).toBe(true);
    if (!outcome.rescued) return; // narrow for the assertions below
    expect(outcome.schedule.resolution.status).toBe("template");
    expect(outcome.recovered.from).toBe("events-only");
    // The captured provenance is the structured reason now (recover gates off the
    // published EvaluatedSchedule, not the evaluator's internal verdict).
    expect(outcome.recovered.reason).toEqual({
      kind: "OVERLAPPING_ABSOLUTE_STARTS",
    });
    expect(outcome.recovered.dsl).toContain("THEN");
    expect(outcome.recovered.residualError).toBe(0);
    expect(outcome.recovered.vestingDayOfMonth).toBe(
      "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    );
  });

  // #75.2: recovery is gated on firing-invariance (event-freeness), not on a
  // literal `FROM DATE`. The same two overlapping grids written off the grant date
  // — `FROM grantDate` and `FROM grantDate + 2 months`, against grantDate
  // 2024-01-01 — are just as recoverable, because a grant-date anchor is a fixed
  // service-time date, not a milestone.
  it("rescues grant-date-anchored grids, not only literal FROM DATE", () => {
    const outcome = evaluateProgramWithRecovery(
      prog(
        "0.5 VEST FROM grantDate OVER 4 months EVERY 1 month PLUS 0.5 VEST FROM grantDate + 2 months OVER 4 months EVERY 1 month",
      ),
      makeCtx({ grantQuantity: 800 }),
    );

    expect(outcome.rescued).toBe(true);
    if (!outcome.rescued) return;
    expect(outcome.schedule.resolution.status).toBe("template");
    expect(outcome.recovered.dsl).toContain("THEN");
    expect(outcome.recovered.residualError).toBe(0);
  });

  it("does not rescue an event-anchored cliff (rejected on reason kind)", () => {
    const outcome = evaluateProgramWithRecovery(
      prog(
        "100 VEST FROM DATE 2024-01-01 OVER 4 months EVERY 1 month CLIFF EVENT ipo",
      ),
      makeCtx({ grantQuantity: 400, events: { ipo: "2024-03-01" } }),
    );

    expect(outcome.rescued).toBe(false);
    expect(outcome.schedule.resolution.status).toBe("events-only");
  });

  // Same reason kind as #43 (OVERLAPPING_ABSOLUTE_STARTS), but an event anchor.
  // Condition (2) would admit it; condition (3) is what turns it away — the
  // whole reason the gate reads the structure and not just the reason kind.
  it("does not rescue an event-origin THEN chain (rejected on the event anchor)", () => {
    const outcome = evaluateProgramWithRecovery(
      prog(
        "200 VEST FROM EVENT ipo OVER 2 months EVERY 1 month THEN 200 VEST OVER 2 months EVERY 1 month",
      ),
      makeCtx({ grantQuantity: 400, events: { ipo: "2024-03-01" } }),
    );

    expect(outcome.rescued).toBe(false);
    expect(outcome.schedule.resolution.status).toBe("events-only");
  });

  // Two grids on different days of the month interleave into a stream with no
  // single-template form. The gate admits it (pure DATE, no events), but the
  // inferrer keeps it a PLUS and the re-classify stays events-only — so the
  // verification step, not the gate, is what declines the rescue here.
  it("does not rescue genuinely interleaved day-of-month grids", () => {
    const outcome = evaluateProgramWithRecovery(
      prog(
        "0.5 VEST FROM DATE 2024-01-01 OVER 4 months EVERY 1 month PLUS 0.5 VEST FROM DATE 2024-01-15 OVER 4 months EVERY 1 month",
      ),
      makeCtx({ grantQuantity: 800 }),
    );

    expect(outcome.rescued).toBe(false);
    expect(outcome.schedule.resolution.status).toBe("events-only");
  });

  it("returns a clean template untouched, with no inference", () => {
    const outcome = evaluateProgramWithRecovery(
      prog("400 VEST FROM DATE 2024-01-01 OVER 4 months EVERY 1 month"),
      makeCtx({ grantQuantity: 400 }),
    );

    expect(outcome.rescued).toBe(false);
    expect(outcome.schedule.resolution.status).toBe("template");
  });

  // An unfired event start resolves to a (pending) template, not events-only —
  // so it short-circuits before the gate and never triggers inference.
  it("leaves a pending program alone", () => {
    const outcome = evaluateProgramWithRecovery(
      prog("400 VEST FROM EVENT ipo OVER 4 months EVERY 1 month"),
      makeCtx({ grantQuantity: 400 }),
    );

    expect(outcome.rescued).toBe(false);
    expect(outcome.schedule.resolution.status).toBe("template");
  });
});
