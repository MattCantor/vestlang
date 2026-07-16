import { describe, it, expect } from "vitest";
import {
  summarizeVerification,
  type BalanceRow,
  type FigureCheck,
  type TrancheRow,
  type VerificationResult,
  type VerificationRow,
} from "../src/verify";

// The summary is a pure formatter over a VerificationResult, so these cases build
// the result directly rather than driving verifyObservations. Only a handful of
// fields feed the line (the rows' check verdicts, `matches`, `worstGap`, and the
// pending/impossible totals); a small factory fills the rest so each case reads as
// just the knobs it exercises.

// A figure-check carrying only the verdict the summary reads; the numeric fields
// are filler.
const check = (withinTolerance: boolean): FigureCheck => ({
  figure: "vested",
  predicted: 0,
  observed: 0,
  delta: 0,
  gap: 0,
  withinTolerance,
});

// A balance row bundling one check per verdict.
const balanceRow = (...verdicts: boolean[]): BalanceRow => {
  const checks = verdicts.map(check);
  return {
    kind: "balance",
    date: "2025-01-01",
    predictedVested: 0,
    predictedUnvested: 0,
    checks,
    passes: checks.every((c) => c.withinTolerance),
  };
};

// A tranche row carrying a single check.
const trancheRow = (withinTolerance: boolean): TrancheRow => {
  const c = check(withinTolerance);
  return {
    kind: "tranche",
    date: "2025-01-01",
    check: c,
    passes: withinTolerance,
  };
};

const result = (fields: {
  rows: VerificationRow[];
  matches: boolean;
  worstGap: number;
  unresolved?: number;
  impossible?: number;
}): VerificationResult => ({
  matches: fields.matches,
  grantQuantity: 1000,
  tolerance: { kind: "percent", value: 5 },
  rows: fields.rows,
  worstGap: fields.worstGap,
  meanGap: 0,
  unresolved: fields.unresolved ?? 0,
  impossible: fields.impossible ?? 0,
  absenceAssumptions: [],
});

describe("summarizeVerification — the all-within-tolerance head", () => {
  it("uses the singular noun for one check", () => {
    const line = summarizeVerification(
      result({ rows: [balanceRow(true)], matches: true, worstGap: 0 }),
    );
    expect(line).toBe(
      "All 1 check within tolerance (worst gap 0.0% of grant).",
    );
  });

  it("pluralizes the check count past one", () => {
    const line = summarizeVerification(
      result({ rows: [balanceRow(true, true)], matches: true, worstGap: 0 }),
    );
    expect(line).toBe(
      "All 2 checks within tolerance (worst gap 0.0% of grant).",
    );
  });
});

describe("summarizeVerification — the failure head", () => {
  it("counts the failing checks over the total, across balance and tranche rows", () => {
    const line = summarizeVerification(
      result({
        rows: [balanceRow(true, true), trancheRow(false)],
        matches: false,
        worstGap: 15,
      }),
    );
    expect(line).toBe(
      "1 of 3 checks outside tolerance (worst gap 15.0% of grant).",
    );
  });
});

describe("summarizeVerification — the pending/impossible tail", () => {
  it("appends the date-less pending and impossible totals when either is nonzero", () => {
    const line = summarizeVerification(
      result({
        rows: [balanceRow(true)],
        matches: true,
        worstGap: 0,
        unresolved: 200,
        impossible: 50,
      }),
    );
    expect(line).toBe(
      "All 1 check within tolerance (worst gap 0.0% of grant); 200 shares pending, 50 impossible.",
    );
  });

  it("omits the tail when nothing is pending or impossible", () => {
    const line = summarizeVerification(
      result({ rows: [balanceRow(true)], matches: true, worstGap: 0 }),
    );
    expect(line).not.toContain("pending");
  });
});

describe("summarizeVerification — the worst gap", () => {
  it("keeps one decimal, rounding a fractional value", () => {
    const line = summarizeVerification(
      result({
        rows: [balanceRow(true, false)],
        matches: false,
        worstGap: 12.34,
      }),
    );
    expect(line).toBe(
      "1 of 2 checks outside tolerance (worst gap 12.3% of grant).",
    );
  });
});
