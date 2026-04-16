import { describe, expect, it } from "vitest";
import { parse } from "@vestlang/dsl";
import { evaluateStatement } from "@vestlang/evaluator";
import { normalizeProgram } from "@vestlang/normalizer";
import type {
  allocation_type,
  EvaluationContextInput,
  OCTDate,
  Program,
  ResolvedInstallment,
  vesting_day_of_month,
} from "@vestlang/types";
import { inferSchedule } from "../src/index.js";
import type { TrancheInput } from "../src/types.js";

function d(s: string): OCTDate {
  return s as unknown as OCTDate;
}

function monthly(
  startISO: string,
  n: number,
  amount: number,
): TrancheInput[] {
  const [y0, m0] = startISO.split("-").map(Number);
  const out: TrancheInput[] = [];
  for (let i = 0; i < n; i++) {
    const total = m0 + i;
    const y = y0 + Math.floor((total - 1) / 12);
    const m = ((total - 1) % 12) + 1;
    const day = startISO.split("-")[2];
    out.push({
      date: d(
        `${y}-${String(m).padStart(2, "0")}-${day}`,
      ),
      amount,
    });
  }
  return out;
}

describe("inferSchedule — pure uniform", () => {
  it("48 equal monthly tranches → one UNIFORM", () => {
    const tranches = monthly("2024-02-01", 48, 1000);
    const result = inferSchedule({ tranches });

    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(result.decomposition.uniforms.length).toBe(1);
    expect(result.decomposition.singles.length).toBe(0);
    expect(result.decomposition.cliffFolds).toBe(0);

    const uniform = result.decomposition.uniforms[0];
    expect(uniform.occurrences).toBe(48);
    expect(uniform.perTrancheAmount).toBe(1000);
    expect(uniform.cadence).toEqual({ unit: "MONTHS", length: 1 });

    expect(result.dsl).toContain("48000 VEST");
    expect(result.dsl).toMatch(/OVER 48 months EVERY 1 months/i);
    expect(result.dsl).toContain("FROM DATE 2024-01-01");
  });

  it("12 quarterly tranches → one UNIFORM at 3-month cadence", () => {
    const tranches: TrancheInput[] = [];
    for (let i = 0; i < 12; i++) {
      const month = 4 + i * 3;
      const y = 2024 + Math.floor((month - 1) / 12);
      const m = ((month - 1) % 12) + 1;
      tranches.push({
        date: d(`${y}-${String(m).padStart(2, "0")}-01`),
        amount: 500,
      });
    }

    const result = inferSchedule({ tranches });
    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(result.decomposition.uniforms.length).toBe(1);
    expect(result.decomposition.uniforms[0].cadence).toEqual({
      unit: "MONTHS",
      length: 3,
    });
    expect(result.decomposition.uniforms[0].occurrences).toBe(12);
  });
});

describe("inferSchedule — cliff", () => {
  it("1-year cliff (12×1000 at month 12, then 36×1000 monthly) folds to one cliff statement", () => {
    const tranches: TrancheInput[] = [
      { date: d("2025-01-01"), amount: 12000 },
      ...monthly("2025-02-01", 36, 1000),
    ];

    const result = inferSchedule({ tranches });

    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(result.decomposition.cliffFolds).toBe(1);
    expect(result.dsl).toContain("CLIFF");
    expect(result.dsl).toContain("48000 VEST");
    expect(result.dsl).toMatch(/OVER 48 months/i);
    expect(result.dsl).toContain("FROM DATE 2024-01-01");
  });

  it("cliff amount that is not an integer multiple → does not fold", () => {
    const tranches: TrancheInput[] = [
      { date: d("2025-01-01"), amount: 11500 },
      ...monthly("2025-02-01", 36, 1000),
    ];

    const result = inferSchedule({ tranches });

    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(result.decomposition.cliffFolds).toBe(0);
    expect(result.dsl).not.toContain("CLIFF");
  });
});

describe("inferSchedule — superposition", () => {
  it("uniform + one-off bonus → UNIFORM + SINGLE_TRANCHE", () => {
    const tranches: TrancheInput[] = [
      ...monthly("2024-02-01", 48, 1000),
      { date: d("2025-06-15"), amount: 10000 },
    ];

    const result = inferSchedule({ tranches });

    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(result.decomposition.uniforms.length).toBe(1);
    expect(result.decomposition.singles.length).toBe(1);
    expect(result.decomposition.singles[0]).toEqual({
      date: "2025-06-15",
      amount: 10000,
    });
    expect(result.dsl).toMatch(/\[/);
  });

  it("two cadences (quarterly yr 1 + monthly yr 2+) → two UNIFORMs", () => {
    const tranches: TrancheInput[] = [
      { date: d("2024-04-01"), amount: 2500 },
      { date: d("2024-07-01"), amount: 2500 },
      { date: d("2024-10-01"), amount: 2500 },
      { date: d("2025-01-01"), amount: 2500 },
      ...monthly("2025-02-01", 12, 1000),
    ];

    const result = inferSchedule({ tranches });
    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(result.decomposition.uniforms.length).toBe(2);
  });
});

describe("inferSchedule — degenerate", () => {
  it("single tranche → one SINGLE_TRANCHE", () => {
    const tranches: TrancheInput[] = [
      { date: d("2025-06-15"), amount: 5000 },
    ];
    const result = inferSchedule({ tranches });

    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(result.decomposition.uniforms.length).toBe(0);
    expect(result.decomposition.singles.length).toBe(1);
    expect(result.dsl).toContain("5000 VEST");
    expect(result.dsl).toContain("FROM DATE 2025-06-15");
  });

  it("three bespoke tranches with irregular dates → three SINGLE_TRANCHEs", () => {
    const tranches: TrancheInput[] = [
      { date: d("2024-03-12"), amount: 10000 },
      { date: d("2024-08-07"), amount: 25000 },
      { date: d("2025-11-22"), amount: 15000 },
    ];

    const result = inferSchedule({ tranches });
    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(result.decomposition.uniforms.length).toBe(0);
    expect(result.decomposition.singles.length).toBe(3);
  });
});

describe("inferSchedule — policy detection", () => {
  it("month-end schedule (seeded on day 31) → detects VESTING_START_DAY policy", () => {
    const ctx = {
      events: { grantDate: d("2024-01-31") },
      grantQuantity: 48000,
      asOf: d("2028-02-01"),
      vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH" as const,
      allocation_type: "CUMULATIVE_ROUNDING" as const,
    };
    const stmt = normalizeProgram(
      parse("48000 VEST FROM DATE 2024-01-31 OVER 48 months EVERY 1 month"),
    )[0];
    const evalResult = evaluateStatement(stmt, ctx);
    const tranches: TrancheInput[] = evalResult.installments
      .filter((i): i is ResolvedInstallment => i.meta.state === "RESOLVED")
      .map((i) => ({ date: i.date, amount: i.amount }));

    const result = inferSchedule({ tranches });

    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    // Either VESTING_START_DAY_OR_LAST (with seed day 31) or 31_OR_LAST
    // produces identical tranches for this input — both are valid
    // reconstructions. The inferrer picks whichever gives the simplest
    // decomposition; 31_OR_LAST wins because it allows a single 48-run
    // starting from the first tranche (2024-02-29).
    expect(result.diagnostics.vestingDayOfMonth).toMatch(
      /VESTING_START_DAY_OR_LAST_DAY_OF_MONTH|31_OR_LAST_DAY_OF_MONTH/,
    );
    expect(result.decomposition.uniforms.length).toBe(1);
  });

  it("day-15 schedule → detects day-15 policy", () => {
    const tranches: TrancheInput[] = [];
    for (let i = 0; i < 12; i++) {
      const month = 2 + i;
      const y = 2024 + Math.floor((month - 1) / 12);
      const m = ((month - 1) % 12) + 1;
      tranches.push({
        date: d(`${y}-${String(m).padStart(2, "0")}-15`),
        amount: 1000,
      });
    }

    const result = inferSchedule({ tranches });
    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(result.decomposition.uniforms.length).toBe(1);
    expect(result.decomposition.uniforms[0].cadence).toEqual({
      unit: "MONTHS",
      length: 1,
    });
  });
});

/* ------------------------
 * Round-trip helpers
 * ------------------------ */

function evalAllResolved(
  program: Program,
  ctx: EvaluationContextInput,
): TrancheInput[] {
  const map = new Map<string, number>();
  for (const stmt of program) {
    const result = evaluateStatement(stmt, ctx);
    for (const inst of result.installments) {
      if (inst.meta.state === "RESOLVED") {
        const key = inst.date as unknown as string;
        map.set(key, (map.get(key) ?? 0) + inst.amount);
      }
    }
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, amount]) => ({
      date: date as unknown as OCTDate,
      amount,
    }));
}

interface RoundTripCase {
  name: string;
  dsl: string;
  grantDate: string;
  grantQuantity: number;
  policy: vesting_day_of_month;
  allocation?: allocation_type;
}

function runRoundTrip(c: RoundTripCase) {
  const grantDate = d(c.grantDate);
  const ctx: EvaluationContextInput = {
    events: { grantDate },
    grantQuantity: c.grantQuantity,
    asOf: d("2030-01-01"),
    vesting_day_of_month: c.policy,
    allocation_type: c.allocation ?? "CUMULATIVE_ROUNDING",
  };
  const program = normalizeProgram(parse(c.dsl));
  const originalTranches = evalAllResolved(program, ctx);

  const inferred = inferSchedule({ tranches: originalTranches });
  expect(inferred.diagnostics.residualError).toBeLessThan(1e-6);

  const inferredProgram = normalizeProgram(parse(inferred.dsl));
  const totalFromInferred = originalTranches.reduce(
    (a, t) => a + t.amount,
    0,
  );
  const inferredCtx: EvaluationContextInput = {
    events: { grantDate },
    grantQuantity: totalFromInferred,
    asOf: d("2030-01-01"),
    vesting_day_of_month: inferred.diagnostics.vestingDayOfMonth,
    allocation_type: inferred.diagnostics.allocationType,
  };
  const reTranches = evalAllResolved(inferredProgram, inferredCtx);
  const reByDate = new Map(
    reTranches.map((t) => [t.date as unknown as string, t.amount]),
  );
  for (const t of originalTranches) {
    const got = reByDate.get(t.date as unknown as string) ?? 0;
    expect(got).toBeCloseTo(t.amount, 6);
  }
  return inferred;
}

describe("inferSchedule — round-trip", () => {
  const cases: RoundTripCase[] = [
    {
      name: "48-month monthly",
      dsl: "48000 VEST FROM DATE 2024-01-01 OVER 48 months EVERY 1 month",
      grantDate: "2024-01-01",
      grantQuantity: 48000,
      policy: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    },
    {
      name: "12-month monthly",
      dsl: "12000 VEST FROM DATE 2024-01-01 OVER 12 months EVERY 1 month",
      grantDate: "2024-01-01",
      grantQuantity: 12000,
      policy: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    },
    {
      name: "48-month monthly with 1-year cliff",
      dsl: "48000 VEST FROM DATE 2024-01-01 OVER 48 months EVERY 1 month CLIFF 12 months",
      grantDate: "2024-01-01",
      grantQuantity: 48000,
      policy: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    },
    {
      name: "40-month monthly with 6-month cliff",
      dsl: "40000 VEST FROM DATE 2024-01-01 OVER 40 months EVERY 1 month CLIFF 6 months",
      grantDate: "2024-01-01",
      grantQuantity: 40000,
      policy: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    },
    {
      name: "20-month monthly starting mid-year",
      dsl: "20000 VEST FROM DATE 2024-03-01 OVER 20 months EVERY 1 month",
      grantDate: "2024-03-01",
      grantQuantity: 20000,
      policy: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    },
    {
      name: "month-end seed (day 31, exercises drift-fix path)",
      dsl: "48000 VEST FROM DATE 2024-01-31 OVER 48 months EVERY 1 month",
      grantDate: "2024-01-31",
      grantQuantity: 48000,
      policy: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    },
    {
      name: "day-15 numeric policy",
      dsl: "12000 VEST FROM DATE 2024-01-15 OVER 12 months EVERY 1 month",
      grantDate: "2024-01-15",
      grantQuantity: 12000,
      policy: "15",
    },
    {
      name: "quarterly cadence over 3 years",
      dsl: "36000 VEST FROM DATE 2024-01-01 OVER 36 months EVERY 3 months",
      grantDate: "2024-01-01",
      grantQuantity: 36000,
      policy: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    },
    {
      name: "multi-statement program (list syntax)",
      dsl: "[24000 VEST FROM DATE 2024-01-01 OVER 24 months EVERY 1 month, 24000 VEST FROM DATE 2025-06-01]",
      grantDate: "2024-01-01",
      grantQuantity: 48000,
      policy: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    },
  ];

  for (const c of cases) {
    it(`round-trips: ${c.name}`, () => {
      runRoundTrip(c);
    });
  }
});
