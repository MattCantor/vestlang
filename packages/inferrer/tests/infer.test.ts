import { describe, expect, it } from "vitest";
import { parse } from "@vestlang/dsl";
import { evaluateProgram, evaluateStatement } from "@vestlang/evaluator";
import { normalizeProgram } from "@vestlang/normalizer";
import type {
  ResolutionContextInput,
  Installment,
  OCTDate,
  Program,
  ResolvedInstallment,
  VestingDayOfMonth,
} from "@vestlang/types";
import { inferSchedule, InferInputError } from "../src/index.js";
import type {
  HypothesisFamily,
  InferResult,
  TrancheInput,
} from "../src/types.js";

function d(s: string): OCTDate {
  return s;
}

/** Count decomposition components carrying a given hypothesis-family tag. The new
 * result shape is one tagged component per emitted statement, so these replace the
 * old `uniforms/singles/cliffFolds/preGrantFolds` counts. */
function nTag(r: InferResult, tag: HypothesisFamily): number {
  return r.decomposition.filter((c) => c.tag === tag).length;
}

function monthly(startISO: string, n: number, amount: number): TrancheInput[] {
  const [y0, m0] = startISO.split("-").map(Number);
  const out: TrancheInput[] = [];
  for (let i = 0; i < n; i++) {
    const total = m0 + i;
    const y = y0 + Math.floor((total - 1) / 12);
    const m = ((total - 1) % 12) + 1;
    const day = startISO.split("-")[2];
    out.push({
      date: d(`${y}-${String(m).padStart(2, "0")}-${day}`),
      amount,
    });
  }
  return out;
}

describe("inferSchedule — pure uniform", () => {
  it("48 equal monthly tranches → one plain uniform", () => {
    const tranches = monthly("2024-02-01", 48, 1000);
    const result = inferSchedule({ tranches });

    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(result.decomposition).toHaveLength(1);
    expect(nTag(result, "plain")).toBe(1);

    const c = result.decomposition[0];
    expect(c.occurrences).toBe(48);
    expect(c.total).toBe(48000);
    expect(c.period).toEqual({ unit: "MONTHS", length: 1 });

    expect(result.dsl).toContain("48000 VEST");
    expect(result.dsl).toMatch(/OVER 48 months EVERY 1 month/i);
    expect(result.dsl).toContain("FROM DATE 2024-01-01");
  });

  it("12 quarterly tranches → one plain uniform at 3-month cadence", () => {
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
    expect(nTag(result, "plain")).toBe(1);
    expect(result.decomposition[0].period).toEqual({
      unit: "MONTHS",
      length: 3,
    });
    expect(result.decomposition[0].occurrences).toBe(12);
  });
});

describe("inferSchedule — cliff", () => {
  it("1-year cliff (lump after the grant date) recovers as one CLIFF statement", () => {
    // Lump at 2025-01-01 is one year AFTER the grant date 2024-01-01, so it is a
    // genuine cliff (12 × 1000 released together).
    const tranches: TrancheInput[] = [
      { date: d("2025-01-01"), amount: 12000 },
      ...monthly("2025-02-01", 36, 1000),
    ];

    const result = inferSchedule({ tranches, grantDate: d("2024-01-01") });

    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(nTag(result, "cliff")).toBe(1);
    expect(nTag(result, "fold")).toBe(0);
    expect(result.dsl).toContain("CLIFF");
    expect(result.dsl).toContain("48000 VEST");
    expect(result.dsl).toMatch(/OVER 48 months/i);
    expect(result.dsl).toContain("FROM DATE 2024-01-01");
  });

  it("cliff amount that is not an integer multiple → no cliff (recovers as a THEN chain)", () => {
    // No folded count's cumulative-round-down floor lands within ±1 of 11500, so
    // the cliff family declines. The head-plus-tail still reproduces exactly, as a
    // two-segment THEN chain — so the honest emission carries no CLIFF token, not a
    // failed fit.
    const tranches: TrancheInput[] = [
      { date: d("2025-01-01"), amount: 11500 },
      ...monthly("2025-02-01", 36, 1000),
    ];

    const result = inferSchedule({ tranches, grantDate: d("2024-01-01") });

    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(nTag(result, "cliff")).toBe(0);
    expect(nTag(result, "fold")).toBe(0);
    expect(result.dsl).not.toContain("CLIFF");
  });

  it("no grant date supplied → still recovers the cliff structurally", () => {
    // Same stream as a cliff, but NO grant date is supplied, so it defaults to the
    // lump date (the first tranche). The cliff family walks the vesting start back
    // from the tail and emits a CLIFF whose 12-month hold lands the lump exactly on
    // that defaulted grant.
    const tranches: TrancheInput[] = [
      { date: d("2025-01-01"), amount: 12000 },
      ...monthly("2025-02-01", 36, 1000),
    ];

    const result = inferSchedule({ tranches });

    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(nTag(result, "cliff")).toBe(1);
    expect(nTag(result, "fold")).toBe(0);
    expect(result.dsl).toContain("CLIFF");
    expect(result.dsl).toMatch(/OVER 48 months/i);
  });

  it("cliff head that drops to a slower rate → a THEN chain, no CLIFF token", () => {
    // A three-month cliff head (300 = 3 × 100), a monthly tail, then a slower
    // monthly tail. The cliff family needs a uniform-amount tail (this one steps
    // 100 → 50), so recovery falls to the per-segment THEN family: a short first
    // segment plus two continuations. One schedule (THEN, not PLUS), but the head
    // reads as a plain segment rather than a CLIFF.
    const tranches: TrancheInput[] = [
      { date: d("2024-02-01"), amount: 300 },
      { date: d("2024-03-01"), amount: 100 },
      { date: d("2024-04-01"), amount: 100 },
      { date: d("2024-05-01"), amount: 100 },
      { date: d("2024-06-01"), amount: 50 },
      { date: d("2024-07-01"), amount: 50 },
      { date: d("2024-08-01"), amount: 50 },
    ];

    const result = inferSchedule({ tranches, grantDate: d("2023-11-01") });

    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(nTag(result, "then-segment")).toBe(3);
    expect(nTag(result, "cliff")).toBe(0);
    expect(result.dsl).toContain("THEN");
    expect(result.dsl).not.toContain("PLUS");
    expect(result.dsl).not.toContain("CLIFF");
  });
});

describe("inferSchedule — pre-grant accrual (lump on the grant date)", () => {
  it("on-grid lump on the grant date, tail a month later → recovered as a CLIFF", () => {
    // Vesting started 2023-10-01, granted 2024-01-01; the 3 pre-grant months lump
    // onto the grant date. Numerically this is identical to a 3-month cliff, and
    // the cliff family (which precedes the pre-grant fold by design) verifies first
    // because the tail sits a month past the lump — so the honest recovery is a
    // CLIFF anchored at the true vesting start, not a bare back-dated train.
    const tranches: TrancheInput[] = [
      { date: d("2024-01-01"), amount: 3000 },
      ...monthly("2024-02-01", 45, 1000),
    ];

    const result = inferSchedule({ tranches, grantDate: d("2024-01-01") });

    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(nTag(result, "cliff")).toBe(1);
    expect(result.dsl).toContain("CLIFF");
    expect(result.dsl).toContain("48000 VEST");
    expect(result.dsl).toMatch(/OVER 48 months EVERY 1 month/i);
    expect(result.dsl).toContain("FROM DATE 2023-10-01");
  });

  it("off-grid lump (hire date) on the grant date → a pre-grant fold, no cliff", () => {
    // Hire/vesting-start 2023-09-29 (~3 months + 2 days before a 2024-01-01 grant).
    // The tail's first installment (2024-01-29) sits in the SAME month as the lump,
    // so the cliff family declines; the pre-grant fold recovers a plain back-dated
    // train whose pre-grant months lump onto the grant date.
    const tranches: TrancheInput[] = [
      { date: d("2024-01-01"), amount: 3000 },
      { date: d("2024-01-29"), amount: 1000 },
      { date: d("2024-02-29"), amount: 1000 },
      { date: d("2024-03-29"), amount: 1000 },
      { date: d("2024-04-29"), amount: 1000 },
      { date: d("2024-05-29"), amount: 1000 },
      { date: d("2024-06-29"), amount: 1000 },
    ];

    const result = inferSchedule({
      tranches,
      grantDate: d("2024-01-01"),
      policy: "VESTING_START_DAY",
    });

    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(nTag(result, "fold")).toBe(1);
    expect(nTag(result, "cliff")).toBe(0);
    expect(result.dsl).not.toContain("CLIFF");
    expect(result.dsl).toContain("FROM DATE 2023-09-29");
  });

  it("rounded train (100000 over 48) with a pre-grant lump → recovered as a CLIFF", () => {
    // 100000/48 does not divide evenly, so installments jitter; recovery is
    // validated by evaluation, not lump = k × perTranche arithmetic. As with the
    // on-grid case, the tail sits a month past the lump, so the cliff reading wins.
    const program = normalizeProgram(
      parse("100000 VEST FROM DATE 2023-10-01 OVER 48 months EVERY 1 month"),
    );
    const full = evalAllResolved(program, {
      grantDate: d("2024-01-01"),
      events: {},
      grantQuantity: 100000,
      vesting_day_of_month: "VESTING_START_DAY",
    });

    const result = inferSchedule({
      tranches: full,
      grantDate: d("2024-01-01"),
      policy: "VESTING_START_DAY",
    });

    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(nTag(result, "cliff")).toBe(1);
    expect(result.dsl).toContain("CLIFF");
    expect(result.dsl).toContain("FROM DATE 2023-10-01");
  });
});

describe("inferSchedule — superposition (additive shapes)", () => {
  it("uniform + one-off bonus → the literal per-date fallback", () => {
    // The analytic core has no additive/peel-and-recurse family, so a monthly train
    // plus an off-grid bonus has no recognized template shape and degrades to the
    // projection-lossless literal fallback (a PLUS list of dated lumps).
    const tranches: TrancheInput[] = [
      ...monthly("2024-02-01", 48, 1000),
      { date: d("2025-06-15"), amount: 10000 },
    ];

    const result = inferSchedule({ tranches });

    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(result.diagnostics.fallback).toBe(true);
    expect(result.decomposition.every((c) => c.tag === "literal")).toBe(true);
    expect(result.dsl).toMatch(/PLUS/);
  });

  it("two cadences (quarterly yr 1 + monthly yr 2+) → one THEN chain", () => {
    // The quarterly year hands off cleanly to the monthly tail on the running
    // cursor: the tail continues one MONTH (its own cadence) past the last
    // quarterly tranche, which lands exactly on the observed monthly grid. The
    // per-segment-cadence THEN family recovers this as one storable template, not
    // two stacked grids.
    const tranches: TrancheInput[] = [
      { date: d("2024-04-01"), amount: 2000 },
      { date: d("2024-07-01"), amount: 2000 },
      { date: d("2024-10-01"), amount: 2000 },
      { date: d("2025-01-01"), amount: 2000 },
      ...monthly("2025-02-01", 12, 1000),
    ];

    const result = inferSchedule({ tranches });
    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(nTag(result, "then-segment")).toBe(2);
    expect(result.dsl).toContain("THEN");
    expect(result.dsl).not.toContain("PLUS");
  });
});

describe("inferSchedule — degenerate", () => {
  it("single tranche → one dated lump (literal)", () => {
    const tranches: TrancheInput[] = [{ date: d("2025-06-15"), amount: 5000 }];
    const result = inferSchedule({ tranches });

    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(result.decomposition).toHaveLength(1);
    expect(nTag(result, "literal")).toBe(1);
    expect(result.dsl).toContain("5000 VEST");
    expect(result.dsl).toContain("FROM DATE 2025-06-15");
  });

  it("three bespoke tranches with irregular dates → three literal lumps", () => {
    const tranches: TrancheInput[] = [
      { date: d("2024-03-12"), amount: 10000 },
      { date: d("2024-08-07"), amount: 25000 },
      { date: d("2025-11-22"), amount: 15000 },
    ];

    const result = inferSchedule({ tranches });
    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(result.diagnostics.fallback).toBe(true);
    expect(nTag(result, "literal")).toBe(3);
  });
});

describe("inferSchedule — zero-total tranche set", () => {
  // A non-empty input whose surviving mass is all zero short-circuits to a single
  // `0 VEST FROM DATE <earliest>` statement (a valid degenerate template) rather
  // than decomposing an empty date set.

  it("(a) single all-zero tranche → degenerate template, no throw", () => {
    const result = inferSchedule({
      tranches: [{ date: d("2025-02-01"), amount: 0 }],
    });

    expect(result.dsl).toBe("0 VEST FROM DATE 2025-02-01");
    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(result.diagnostics.totalQuantity).toBe(0);
    expect(result.decomposition).toEqual([
      {
        tag: "literal",
        start: "2025-02-01",
        occurrences: 1,
        period: { unit: "DAYS", length: 0 },
        total: 0,
      },
    ]);
  });

  it("(b) multiple zero tranches on different dates → single statement at earliest", () => {
    const result = inferSchedule({
      tranches: [
        { date: d("2025-05-01"), amount: 0 },
        { date: d("2025-01-01"), amount: 0 },
        { date: d("2025-03-01"), amount: 0 },
      ],
    });

    expect(result.dsl).toBe("0 VEST FROM DATE 2025-01-01");
    expect(result.diagnostics.totalQuantity).toBe(0);
    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(result.program).toHaveLength(1);
  });

  it("(c) the degenerate DSL round-trips to an empty installment stream at residual 0", () => {
    const result = inferSchedule({
      tranches: [{ date: d("2025-02-01"), amount: 0 }],
    });

    const program = normalizeProgram(parse(result.dsl));
    const reTranches = evalAllResolved(program, {
      grantDate: d("2025-02-01"),
      events: {},
      grantQuantity: 0,
      vesting_day_of_month: result.diagnostics.vestingDayOfMonth,
    });

    expect(reTranches).toHaveLength(0);
    expect(reTranches.some((t) => t.amount > 0)).toBe(false);
  });

  it("(d) fix is in core — direct call returns a result and never throws", () => {
    expect(() =>
      inferSchedule({ tranches: [{ date: d("2025-02-01"), amount: 0 }] }),
    ).not.toThrow();
  });

  it("(e) mixed input still drops interior zeros", () => {
    // Only the 100-share row survives; the two zero rows are dropped. The single
    // survivor recovers as a grant-anchored one-occurrence train (the grant date
    // defaults to the earliest date, 2025-01-01, two months before it), projecting
    // exactly one tranche of 100 on 2025-03-01.
    const result = inferSchedule({
      tranches: [
        { date: d("2025-01-01"), amount: 0 },
        { date: d("2025-03-01"), amount: 100 },
        { date: d("2025-05-01"), amount: 0 },
      ],
    });

    expect(result.diagnostics.totalQuantity).toBe(100);
    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(result.decomposition).toHaveLength(1);
    expect(result.decomposition[0].total).toBe(100);

    // The dropped zeros leave a single tranche of 100 on the surviving date.
    const reTranches = evalAllResolved(normalizeProgram(parse(result.dsl)), {
      grantDate: d("2025-01-01"),
      events: {},
      grantQuantity: 100,
      vesting_day_of_month: result.diagnostics.vestingDayOfMonth,
    });
    expect(reTranches).toEqual([{ date: "2025-03-01", amount: 100 }]);
  });

  it("(i) a caller-supplied policy is echoed, not overridden", () => {
    const withPolicy = inferSchedule({
      tranches: [{ date: d("2025-02-01"), amount: 0 }],
      policy: "LAST_DAY_OF_MONTH",
    });
    expect(withPolicy.diagnostics.vestingDayOfMonth).toBe("LAST_DAY_OF_MONTH");

    const withoutPolicy = inferSchedule({
      tranches: [{ date: d("2025-02-01"), amount: 0 }],
    });
    expect(withoutPolicy.diagnostics.vestingDayOfMonth).toBe(
      "VESTING_START_DAY",
    );
  });
});

describe("inferSchedule — policy detection", () => {
  it("month-end schedule (seeded on day 31) → a month-end day-of-month policy", () => {
    const ctx = {
      grantDate: d("2024-01-31"),
      events: {},
      grantQuantity: 48000,
      vesting_day_of_month: "VESTING_START_DAY" as const,
    };
    const stmt = normalizeProgram(
      parse("48000 VEST FROM DATE 2024-01-31 OVER 48 months EVERY 1 month"),
    )[0];
    const installments: Installment[] = evaluateStatement(stmt, ctx).resolution
      .installments;
    const tranches: TrancheInput[] = installments
      .filter((i): i is ResolvedInstallment => i.state === "RESOLVED")
      .map((i) => ({ date: i.date, amount: i.amount }));

    const result = inferSchedule({ tranches });

    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    // Either VESTING_START_DAY (seeded day 31) or LAST_DAY_OF_MONTH reproduces this
    // month-end stream; the month-end pattern prefers LAST_DAY_OF_MONTH.
    expect(result.diagnostics.vestingDayOfMonth).toMatch(
      /VESTING_START_DAY|LAST_DAY_OF_MONTH/,
    );
    expect(nTag(result, "plain")).toBe(1);
  });

  it("mid-month schedule (the 15th) → one plain monthly train", () => {
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
    expect(nTag(result, "plain")).toBe(1);
    expect(result.decomposition[0].period).toEqual({
      unit: "MONTHS",
      length: 1,
    });
  });

  it("explicit MINUS_ONE hint projects an end-of-month stream into a clean fit", () => {
    const tranches: TrancheInput[] = [
      { date: d("2025-02-27"), amount: 1000 },
      { date: d("2025-03-30"), amount: 1000 },
      { date: d("2025-04-29"), amount: 1000 },
      { date: d("2025-05-30"), amount: 1000 },
      { date: d("2025-06-29"), amount: 1000 },
      { date: d("2025-07-30"), amount: 1000 },
    ];

    const result = inferSchedule({
      tranches,
      policy: "VESTING_START_DAY_MINUS_ONE",
    });

    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(result.diagnostics.vestingDayOfMonth).toBe(
      "VESTING_START_DAY_MINUS_ONE",
    );
    expect(result.diagnostics.totalQuantity).toBe(6000);
  });

  it("day-31-start MINUS_ONE stream recovers under MINUS_ONE with no hint", () => {
    // The #503 mechanism through the real public surface: a month-end (day-31 seed)
    // train projected under VESTING_START_DAY_MINUS_ONE is recovered — dom and all —
    // with NO policy hint supplied, because the month-end pattern's derived
    // candidate set includes MINUS_ONE.
    const stmt = normalizeProgram(
      parse("6000 VEST FROM DATE 2024-01-31 OVER 6 months EVERY 1 month"),
    )[0];
    const installments: Installment[] = evaluateStatement(stmt, {
      grantDate: d("2024-01-31"),
      events: {},
      grantQuantity: 6000,
      vesting_day_of_month: "VESTING_START_DAY_MINUS_ONE",
    }).resolution.installments;
    const tranches: TrancheInput[] = installments
      .filter((i): i is ResolvedInstallment => i.state === "RESOLVED")
      .map((i) => ({ date: i.date, amount: i.amount }));

    const result = inferSchedule({ tranches });

    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(result.diagnostics.vestingDayOfMonth).toBe(
      "VESTING_START_DAY_MINUS_ONE",
    );
    expect(result.diagnostics.totalQuantity).toBe(6000);
  });
});

describe("inferSchedule — THEN chain recovery", () => {
  // A grant whose monthly rate doubles for two months and then drops back — one
  // schedule with a rate change, recovered as a three-segment THEN chain.
  const RATE_CHANGE: TrancheInput[] = [
    { date: "2023-12-01", amount: 100 },
    { date: "2024-01-01", amount: 100 },
    { date: "2024-02-01", amount: 200 },
    { date: "2024-03-01", amount: 200 },
    { date: "2024-04-01", amount: 100 },
    { date: "2024-05-01", amount: 100 },
  ];

  function collapseStatus(inferred: InferResult, grantDate: OCTDate): string {
    const program = normalizeProgram(parse(inferred.dsl));
    return evaluateProgram(program, {
      grantDate,
      events: {},
      grantQuantity: inferred.diagnostics.totalQuantity,
      vesting_day_of_month: inferred.diagnostics.vestingDayOfMonth,
    }).resolution.status;
  }

  it("turns a rate-change stream into a single THEN template", () => {
    const inferred = inferSchedule({ tranches: RATE_CHANGE });
    expect(inferred.diagnostics.residualError).toBeLessThan(1e-6);
    expect(nTag(inferred, "then-segment")).toBe(3);
    expect(inferred.dsl).toContain("THEN");
    expect(inferred.dsl).not.toContain("PLUS");
    expect(collapseStatus(inferred, RATE_CHANGE[0].date)).toBe("template");
  });

  it("emits a head followed by chained tails, never the other way round", () => {
    const program = normalizeProgram(
      parse(inferSchedule({ tranches: RATE_CHANGE }).dsl),
    );
    expect(program.map((s) => s.chained ?? false)).toEqual([false, true, true]);
  });

  it("a cliff head handing off to a quarterly tail → a THEN chain, no CLIFF token", () => {
    // A monthly cliff head then a quarterly tail — a cadence change. The
    // per-segment-cadence THEN family recovers it as one template, but (like the
    // slower-rate case) the head reads as a plain segment, not a CLIFF.
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
    expect(inferred.diagnostics.residualError).toBeLessThan(1e-6);
    expect(nTag(inferred, "then-segment")).toBe(3);
    expect(inferred.dsl).toContain("THEN");
    expect(inferred.dsl).not.toContain("PLUS");
    expect(inferred.dsl).not.toContain("CLIFF");
    expect(collapseStatus(inferred, "2023-11-01")).toBe("template");
  });

  it("a month-end rate change stays one template through the clamping", () => {
    // The head ends on a 31st-of-month grid; its next slot springs back to Feb 29,
    // and the rate then triples. Written as THEN the tail has no date of its own
    // and just continues the grid, so it stays one template.
    const monthEnd: TrancheInput[] = [
      { date: "2023-12-31", amount: 75 },
      { date: "2024-01-31", amount: 75 },
      { date: "2024-02-29", amount: 225 },
      { date: "2024-03-31", amount: 225 },
    ];
    const inferred = inferSchedule({
      tranches: monthEnd,
      grantDate: "2023-11-30",
    });
    expect(inferred.diagnostics.residualError).toBeLessThan(1e-6);
    expect(inferred.dsl).toContain("THEN");
    expect(collapseStatus(inferred, "2023-11-30")).toBe("template");
  });
});

describe("inferSchedule — collapse residual honesty (#147)", () => {
  it("a lump plus a fast train reproduces without re-allocating onto the grant date", () => {
    // The #147 repro: a 360-share lump on the grant date, then 105 every three
    // days. The emitted DSL, re-evaluated the way a consumer does (one collapsed
    // program walk), must not re-allocate the train's mass back onto the grant date.
    const tranches: TrancheInput[] = [{ date: "2025-02-01", amount: 360 }];
    for (
      let day = new Date("2025-02-04T00:00:00Z");
      day <= new Date("2025-02-25T00:00:00Z");
      day.setUTCDate(day.getUTCDate() + 3)
    ) {
      tranches.push({ date: day.toISOString().slice(0, 10), amount: 105 });
    }

    const inferred = inferSchedule({ tranches, grantDate: "2025-02-01" });
    expect(inferred.diagnostics.residualError).toBeLessThan(1e-6);

    const total = tranches.reduce((a, t) => a + t.amount, 0);
    const reTranches = evalAllResolved(normalizeProgram(parse(inferred.dsl)), {
      grantDate: "2025-02-01",
      events: {},
      grantQuantity: total,
      vesting_day_of_month: inferred.diagnostics.vestingDayOfMonth,
    });
    const byDate = new Map(reTranches.map((t) => [t.date, t.amount]));

    // No re-allocation onto the grant date — 360, not 360 + 105.
    expect(byDate.get("2025-02-01")).toBe(360);
    for (const t of tranches) {
      expect(byDate.get(t.date) ?? 0).toBe(t.amount);
    }
  });
});

/* ------------------------
 * Round-trip helpers
 * ------------------------ */

function evalAllResolved(
  program: Program,
  ctx: ResolutionContextInput,
): TrancheInput[] {
  const map = new Map<string, number>();
  for (const stmt of program) {
    const result = evaluateStatement(stmt, ctx);
    for (const inst of result.resolution.installments) {
      if (inst.state === "RESOLVED") {
        map.set(inst.date, (map.get(inst.date) ?? 0) + inst.amount);
      }
    }
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, amount]) => ({
      date: date,
      amount,
    }));
}

/** Collapse a whole program (the way a consumer re-evaluates emitted DSL) and sum
 * RESOLVED installments by date. Needed for an inferred program that may be a THEN
 * chain: a chained tail can't be evaluated on its own — only the whole-program
 * collapse threads the handoffs. */
function evalProgramResolved(
  program: Program,
  ctx: ResolutionContextInput,
): TrancheInput[] {
  const map = new Map<string, number>();
  for (const inst of evaluateProgram(program, ctx).resolution.installments) {
    if (inst.state === "RESOLVED") {
      map.set(inst.date, (map.get(inst.date) ?? 0) + inst.amount);
    }
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, amount]) => ({ date, amount }));
}

interface RoundTripCase {
  name: string;
  dsl: string;
  grantDate: string;
  grantQuantity: number;
  policy: VestingDayOfMonth;
}

function runRoundTrip(c: RoundTripCase) {
  const grantDate = d(c.grantDate);
  const ctx: ResolutionContextInput = {
    grantDate,
    events: {},
    grantQuantity: c.grantQuantity,
    vesting_day_of_month: c.policy,
  };
  const program = normalizeProgram(parse(c.dsl));
  const originalTranches = evalAllResolved(program, ctx);

  const inferred = inferSchedule({ tranches: originalTranches, grantDate });
  expect(inferred.diagnostics.residualError).toBeLessThan(1e-6);

  const inferredProgram = normalizeProgram(parse(inferred.dsl));
  const totalFromInferred = originalTranches.reduce((a, t) => a + t.amount, 0);
  const inferredCtx: ResolutionContextInput = {
    grantDate,
    events: {},
    grantQuantity: totalFromInferred,
    vesting_day_of_month: inferred.diagnostics.vestingDayOfMonth,
  };
  const reTranches = evalProgramResolved(inferredProgram, inferredCtx);
  const reByDate = new Map(reTranches.map((t) => [t.date, t.amount]));
  for (const t of originalTranches) {
    const got = reByDate.get(t.date) ?? 0;
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
      policy: "VESTING_START_DAY",
    },
    {
      name: "12-month monthly",
      dsl: "12000 VEST FROM DATE 2024-01-01 OVER 12 months EVERY 1 month",
      grantDate: "2024-01-01",
      grantQuantity: 12000,
      policy: "VESTING_START_DAY",
    },
    {
      name: "48-month monthly with 1-year cliff",
      dsl: "48000 VEST FROM DATE 2024-01-01 OVER 48 months EVERY 1 month CLIFF 12 months",
      grantDate: "2024-01-01",
      grantQuantity: 48000,
      policy: "VESTING_START_DAY",
    },
    {
      name: "40-month monthly with 6-month cliff",
      dsl: "40000 VEST FROM DATE 2024-01-01 OVER 40 months EVERY 1 month CLIFF 6 months",
      grantDate: "2024-01-01",
      grantQuantity: 40000,
      policy: "VESTING_START_DAY",
    },
    {
      name: "20-month monthly starting mid-year",
      dsl: "20000 VEST FROM DATE 2024-03-01 OVER 20 months EVERY 1 month",
      grantDate: "2024-03-01",
      grantQuantity: 20000,
      policy: "VESTING_START_DAY",
    },
    {
      name: "month-end seed (day 31, exercises drift-fix path)",
      dsl: "48000 VEST FROM DATE 2024-01-31 OVER 48 months EVERY 1 month",
      grantDate: "2024-01-31",
      grantQuantity: 48000,
      policy: "VESTING_START_DAY",
    },
    {
      name: "month-end policy (LAST_DAY_OF_MONTH)",
      dsl: "12000 VEST FROM DATE 2024-01-15 OVER 12 months EVERY 1 month",
      grantDate: "2024-01-15",
      grantQuantity: 12000,
      policy: "LAST_DAY_OF_MONTH",
    },
    {
      name: "quarterly cadence over 3 years",
      dsl: "36000 VEST FROM DATE 2024-01-01 OVER 36 months EVERY 3 months",
      grantDate: "2024-01-01",
      grantQuantity: 36000,
      policy: "VESTING_START_DAY",
    },
    {
      name: "multi-statement program (PLUS composition)",
      dsl: "24000 VEST FROM DATE 2024-01-01 OVER 24 months EVERY 1 month PLUS 24000 VEST FROM DATE 2025-06-01",
      grantDate: "2024-01-01",
      grantQuantity: 48000,
      policy: "VESTING_START_DAY",
    },
  ];

  for (const c of cases) {
    it(`round-trips: ${c.name}`, () => {
      runRoundTrip(c);
    });
  }
});

describe("inferSchedule — rounded trains", () => {
  // A total that does not divide evenly across its occurrences yields per-tranche
  // amounts that differ by 1 under cumulative round-down. Recovery must recognize
  // such a jittery run as a single plain uniform preserving the exact total.
  const cases: Array<{ total: number; over: number }> = [
    { total: 10000, over: 48 },
    { total: 100, over: 3 },
    { total: 10000, over: 7 },
    { total: 5000, over: 36 },
    { total: 333, over: 12 },
  ];

  for (const c of cases) {
    it(`folds ${c.total} over ${c.over} months into one plain uniform`, () => {
      const ctx: ResolutionContextInput = {
        grantDate: d("2024-01-01"),
        events: {},
        grantQuantity: c.total,
        vesting_day_of_month: "VESTING_START_DAY",
      };
      const stmt = normalizeProgram(
        parse(
          `${c.total} VEST FROM DATE 2024-01-01 OVER ${c.over} months EVERY 1 month`,
        ),
      )[0];
      const installments: Installment[] = evaluateStatement(stmt, ctx)
        .resolution.installments;
      const tranches: TrancheInput[] = installments
        .filter((i): i is ResolvedInstallment => i.state === "RESOLVED")
        .map((i) => ({ date: i.date, amount: i.amount }));

      // Sanity: the run really is jittery (amounts are not all equal).
      expect(new Set(tranches.map((t) => t.amount)).size).toBeGreaterThan(1);

      const result = inferSchedule({ tranches });

      expect(result.diagnostics.residualError).toBeLessThan(1e-6);
      expect(result.decomposition).toHaveLength(1);
      expect(nTag(result, "plain")).toBe(1);

      const u = result.decomposition[0];
      expect(u.occurrences).toBe(c.over);
      expect(u.total).toBe(c.total);
      expect(u.period).toEqual({ unit: "MONTHS", length: 1 });
    });
  }
});

/* ------------------------
 * Data-adaptive cadence
 * ------------------------ */

/** `n` tranches starting at (startY, startM) stepping `step` calendar months. */
function everyMonths(
  startY: number,
  startM: number,
  step: number,
  n: number,
  amount: number,
  day = 1,
): TrancheInput[] {
  const out: TrancheInput[] = [];
  let y = startY;
  let m = startM;
  for (let i = 0; i < n; i++) {
    out.push({
      date: d(
        `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      ),
      amount,
    });
    m += step;
    while (m > 12) {
      m -= 12;
      y++;
    }
  }
  return out;
}

/** `n` tranches starting at `startISO` stepping `step` days. */
function everyDays(
  startISO: string,
  step: number,
  n: number,
  amount: number,
): TrancheInput[] {
  const base = new Date(`${startISO}T00:00:00Z`).getTime();
  const out: TrancheInput[] = [];
  for (let i = 0; i < n; i++) {
    const dt = new Date(base + i * step * 86_400_000);
    out.push({
      date: d(
        `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`,
      ),
      amount,
    });
  }
  return out;
}

describe("inferSchedule — data-adaptive cadence", () => {
  it("every-2-month (out of vocabulary) → one plain uniform at 2-month cadence", () => {
    const result = inferSchedule({
      tranches: everyMonths(2024, 1, 2, 12, 2000),
    });
    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(nTag(result, "plain")).toBe(1);
    expect(result.decomposition[0].period).toEqual({
      unit: "MONTHS",
      length: 2,
    });
    expect(result.decomposition[0].occurrences).toBe(12);
    expect(result.dsl).toMatch(/EVERY 2 months/i);
  });

  it("every-5-month (out of vocabulary) → one plain uniform at 5-month cadence", () => {
    const result = inferSchedule({
      tranches: everyMonths(2024, 1, 5, 10, 3000),
    });
    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(nTag(result, "plain")).toBe(1);
    expect(result.decomposition[0].period).toEqual({
      unit: "MONTHS",
      length: 5,
    });
    expect(result.decomposition[0].occurrences).toBe(10);
    expect(result.dsl).toMatch(/EVERY 5 months/i);
  });

  it("monthly train + every-5-month bonus → the literal per-date fallback", () => {
    // The bonus train sits off the monthly grid (day 15). With no additive family
    // the superposition has no recognized template shape and degrades to the
    // literal fallback.
    const tranches: TrancheInput[] = [
      ...monthly("2024-01-01", 24, 1000),
      ...everyMonths(2024, 5, 5, 4, 2000, 15),
    ];
    const result = inferSchedule({ tranches });
    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(result.diagnostics.fallback).toBe(true);
    expect(result.decomposition.every((c) => c.tag === "literal")).toBe(true);
  });

  it("flat biweekly → one plain uniform at 14-day cadence (issue #3)", () => {
    const result = inferSchedule({
      tranches: everyDays("2024-01-01", 14, 26, 500),
    });
    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(nTag(result, "plain")).toBe(1);
    expect(result.decomposition[0].period).toEqual({
      unit: "DAYS",
      length: 14,
    });
  });

  it("arbitrary 45-day cadence → one plain uniform (issue #3)", () => {
    const result = inferSchedule({
      tranches: everyDays("2024-01-01", 45, 8, 750),
    });
    expect(result.diagnostics.residualError).toBeLessThan(1e-6);
    expect(nTag(result, "plain")).toBe(1);
    expect(result.decomposition[0].period).toEqual({
      unit: "DAYS",
      length: 45,
    });
  });
});

describe("inferSchedule — input contract", () => {
  it("throws InferInputError on empty tranches", () => {
    expect(() => inferSchedule({ tranches: [] })).toThrow(InferInputError);
  });

  it("throws InferInputError on a fractional amount", () => {
    expect(() =>
      inferSchedule({
        tranches: [
          { date: "2025-01-01", amount: 31.25 },
          { date: "2025-02-01", amount: 31.25 },
        ],
      }),
    ).toThrow(InferInputError);
  });

  it("throws InferInputError on a negative amount", () => {
    expect(() =>
      inferSchedule({
        tranches: [
          { date: "2025-01-01", amount: -10 },
          { date: "2025-02-01", amount: 20 },
        ],
      }),
    ).toThrow(InferInputError);
  });
});
