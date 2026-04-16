import { describe, expect, it } from "vitest";
import { parse } from "@vestlang/dsl";
import { evaluateStatement } from "@vestlang/evaluator";
import { inferSchedule } from "@vestlang/inferrer";
import { normalizeProgram } from "@vestlang/normalizer";
import type { OCTDate, ResolvedInstallment } from "@vestlang/types";

describe("mcp-server / vestlang_infer_schedule", () => {
  it("round-trips a 4-year monthly cliff schedule via inferSchedule → parse → evaluate", () => {
    const originalDsl =
      "48000 VEST FROM DATE 2024-01-01 OVER 48 months EVERY 1 month CLIFF 12 months";
    const grantDate = "2024-01-01" as OCTDate;
    const originalProgram = normalizeProgram(parse(originalDsl));
    const ctx = {
      events: { grantDate },
      grantQuantity: 48000,
      asOf: "2028-02-01" as OCTDate,
      vesting_day_of_month:
        "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH" as const,
      allocation_type: "CUMULATIVE_ROUNDING" as const,
    };
    const originalInstallments = evaluateStatement(
      originalProgram[0],
      ctx,
    ).installments.filter(
      (i): i is ResolvedInstallment => i.meta.state === "RESOLVED",
    );

    const tranches = originalInstallments.map((i) => ({
      date: i.date,
      amount: i.amount,
    }));

    const inferred = inferSchedule({ tranches });
    expect(inferred.diagnostics.residualError).toBeLessThan(1e-6);
    expect(inferred.decomposition.cliffFolds).toBe(1);

    const reparsed = normalizeProgram(parse(inferred.dsl));
    const reCtx = {
      events: { grantDate },
      grantQuantity: 48000,
      asOf: "2028-02-01" as OCTDate,
      vesting_day_of_month: inferred.diagnostics.vestingDayOfMonth,
      allocation_type: inferred.diagnostics.allocationType,
    };
    const reInstallments = reparsed.flatMap((stmt) =>
      evaluateStatement(stmt, reCtx).installments.filter(
        (i): i is ResolvedInstallment => i.meta.state === "RESOLVED",
      ),
    );

    const byDate = new Map<string, number>();
    for (const inst of reInstallments) {
      const k = inst.date as unknown as string;
      byDate.set(k, (byDate.get(k) ?? 0) + inst.amount);
    }

    for (const orig of originalInstallments) {
      const got = byDate.get(orig.date as unknown as string) ?? 0;
      expect(got).toBeCloseTo(orig.amount, 6);
    }
  });
});
