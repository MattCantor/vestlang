import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateStatementAsOf } from "@vestlang/evaluator";
import type { EvaluationContextInput, OCTDate } from "@vestlang/types";
import { computeSummary, filterByWindow } from "../src/summary.js";

const ctx = (overrides: Partial<EvaluationContextInput> = {}): EvaluationContextInput => ({
  events: { grantDate: "2025-01-01" as OCTDate },
  grantQuantity: 100000,
  asOf: "2026-04-16" as OCTDate,
  allocation_type: "CUMULATIVE_ROUND_DOWN",
  ...overrides,
});

const run = (dsl: string, context = ctx()) => {
  const program = normalizeProgram(parse(dsl));
  return evaluateStatementAsOf(program[0]!, context);
};

describe("computeSummary", () => {
  it("sums vested and reports percent for mid-schedule as_of", () => {
    const result = run("VEST OVER 4 years EVERY 1 month CLIFF 1 year");
    const s = computeSummary(result, 100000);

    // Cliff (25000) + 3 monthly tranches of ~2083 each = 31250
    expect(s.total_vested).toBe(31250);
    expect(s.total_unvested).toBe(68750);
    expect(s.total_impossible).toBe(0);
    expect(s.percent_vested).toBe(0.3125);
    expect(s.cliff_date).toBe("2026-01-01");
    expect(s.next_vest_date).toBe("2026-05-01");
    expect(s.fully_vested_date).toBe("2029-01-01");
  });

  it("fully_vested_date is null when schedule has unresolved installments", () => {
    const result = run(
      "VEST FROM EVENT ipo OVER 2 years EVERY 1 month",
      ctx({ events: { grantDate: "2025-01-01" as OCTDate } }),
    );
    const s = computeSummary(result, 100000);
    expect(s.fully_vested_date).toBeNull();
    expect(s.total_vested).toBe(0);
  });

  it("cliff_date is null when nothing has vested yet", () => {
    const result = run(
      "VEST OVER 4 years EVERY 1 month CLIFF 1 year",
      ctx({ asOf: "2025-06-01" as OCTDate }),
    );
    const s = computeSummary(result, 100000);
    expect(s.cliff_date).toBeNull();
    expect(s.total_vested).toBe(0);
    expect(s.next_vest_date).toBe("2026-01-01");
    expect(s.next_vest_amount).toBe(25000);
  });

  it("percent_vested is 0 when grantQuantity is 0", () => {
    const result = run(
      "VEST OVER 12 months EVERY 1 month",
      ctx({ grantQuantity: 0 }),
    );
    const s = computeSummary(result, 0);
    expect(s.percent_vested).toBe(0);
  });

  it("rounds percent_vested to 4 decimal places", () => {
    // 1/3 = 0.3333... → 0.3333
    const result = run(
      "VEST OVER 3 months EVERY 1 month",
      ctx({
        grantQuantity: 100,
        asOf: "2025-02-01" as OCTDate,
      }),
    );
    const s = computeSummary(result, 100);
    expect(s.total_vested).toBe(33);
    expect(s.percent_vested).toBe(0.33);
  });
});

describe("filterByWindow", () => {
  it("counts tranches within an inclusive window", () => {
    const result = run("VEST OVER 4 years EVERY 1 month CLIFF 1 year");
    const { installments, total } = filterByWindow(
      result.vested,
      "2026-01-01" as OCTDate,
      "2026-03-31" as OCTDate,
    );
    // Cliff (25000) + Feb (2083) + Mar (2083) = 29166
    expect(installments.length).toBe(3);
    expect(total).toBe(29166);
  });

  it("returns empty for a window before any vesting", () => {
    const result = run("VEST OVER 4 years EVERY 1 month CLIFF 1 year");
    const { installments, total } = filterByWindow(
      result.vested,
      "2025-06-01" as OCTDate,
      "2025-12-31" as OCTDate,
    );
    expect(installments).toHaveLength(0);
    expect(total).toBe(0);
  });

  it("window bounds are inclusive on both ends", () => {
    const result = run("VEST OVER 4 years EVERY 1 month CLIFF 1 year");
    const { installments, total } = filterByWindow(
      result.vested,
      "2026-01-01" as OCTDate,
      "2026-01-01" as OCTDate,
    );
    expect(installments).toHaveLength(1);
    expect(total).toBe(25000);
  });
});
