import { describe, expect, it } from "vitest";
import { inferSchedule } from "@vestlang/inferrer";
import type { TrancheInput } from "@vestlang/inferrer";
import { runEvaluate } from "@vestlang/pipeline";
import type { ResolvedInstallment } from "@vestlang/types";

// The inferrer advertises an "always round-trip verified" guarantee, but it
// verifies through `evaluateProgram` — the whole-program collapse — while
// consumers re-evaluate the emitted DSL through `runEvaluate`. Before #143 that
// path computed a per-statement breakdown, which threw on any THEN chain the
// inferrer emitted. These tests close the gap: every THEN-emitting candidate
// family must survive the actual consumer path, not just the verifier's.

const grantQuantity = (tranches: TrancheInput[]) =>
  tranches.reduce((n, t) => n + t.amount, 0);

/** Infer a schedule from a tranche stream, then re-evaluate the emitted DSL the
 *  way a consumer does — through `runEvaluate`. Returns the inferred DSL and the
 *  run result so a test can assert on both. */
function inferThenEvaluate(tranches: TrancheInput[], grantDate: string) {
  const inferred = inferSchedule({ tranches, grantDate });
  const result = runEvaluate(inferred.dsl, {
    grant_date: grantDate,
    grant_quantity: grantQuantity(tranches),
    vesting_day_of_month: inferred.diagnostics.vestingDayOfMonth,
  });
  return { dsl: inferred.dsl, result };
}

describe("inferrer → runEvaluate round-trip (the consumer path)", () => {
  // Family 1: a plain forward rate change. The inferrer segments it into
  // back-to-back equal-rate runs and writes them as a head + chained tails.
  it("recovers a rate-change stream as a THEN chain that runEvaluate accepts", () => {
    const rateChange: TrancheInput[] = [
      { date: "2023-12-01", amount: 100 },
      { date: "2024-01-01", amount: 100 },
      { date: "2024-02-01", amount: 200 },
      { date: "2024-03-01", amount: 200 },
      { date: "2024-04-01", amount: 100 },
      { date: "2024-05-01", amount: 100 },
    ];
    const { dsl, result } = inferThenEvaluate(rateChange, "2023-12-01");
    expect(dsl).toContain("THEN");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.view.resolution.status).toBe("template");
      // Every original tranche is reproduced — the round-trip is exact.
      const produced = result.view.installments
        .filter((i): i is ResolvedInstallment => i.state === "RESOLVED")
        .reduce((n, i) => n + i.amount, 0);
      expect(produced).toBe(grantQuantity(rateChange));
      // The whole chain attributes to one breakdown entry.
      expect(result.breakdown).toHaveLength(1);
    }
  });

  // Family 2: a cliff head that hands off to a slower tail. The inferrer folds
  // the lead lump into a CLIFF on the head statement, then chains the tail.
  it("recovers a cliff-head THEN tail that runEvaluate accepts", () => {
    const cliffThenTail: TrancheInput[] = [
      { date: "2024-02-01", amount: 300 },
      { date: "2024-03-01", amount: 100 },
      { date: "2024-04-01", amount: 100 },
      { date: "2024-05-01", amount: 100 },
      { date: "2024-06-01", amount: 50 },
      { date: "2024-07-01", amount: 50 },
      { date: "2024-08-01", amount: 50 },
    ];
    const { dsl, result } = inferThenEvaluate(cliffThenTail, "2023-11-01");
    expect(dsl).toContain("CLIFF");
    expect(dsl).toContain("THEN");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.view.resolution.status).toBe("template");
      const produced = result.view.installments
        .filter((i): i is ResolvedInstallment => i.state === "RESOLVED")
        .reduce((n, i) => n + i.amount, 0);
      expect(produced).toBe(grantQuantity(cliffThenTail));
      expect(result.breakdown).toHaveLength(1);
    }
  });

  // Family 3: a rate change whose handoff falls on a short month. The chain's
  // grid springs back to the month's last day; written as THEN the tail carries
  // no start of its own, so the clamp can't strand it off the running grid.
  //
  // The head (200 of 800 = 1/4) and tail (600 of 800 = 3/4) are terminating
  // shares, so the inferred THEN chain stores both percentages exactly and
  // round-trips. A split into thirds wouldn't: each statement's percentage stores
  // as a truncated Numeric decimal, the re-evaluated chain wouldn't reproduce the
  // stream, and the inferrer would (correctly) fall back to independent dated
  // amounts instead of a THEN chain.
  it("recovers a month-end-clamped THEN chain that runEvaluate accepts", () => {
    const monthEnd: TrancheInput[] = [
      { date: "2023-12-31", amount: 100 },
      { date: "2024-01-31", amount: 100 },
      { date: "2024-02-29", amount: 300 },
      { date: "2024-03-31", amount: 300 },
    ];
    const { dsl, result } = inferThenEvaluate(monthEnd, "2023-11-30");
    expect(dsl).toContain("THEN");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.view.resolution.status).toBe("template");
      const produced = result.view.installments
        .filter((i): i is ResolvedInstallment => i.state === "RESOLVED")
        .reduce((n, i) => n + i.amount, 0);
      expect(produced).toBe(grantQuantity(monthEnd));
    }
  });
});
