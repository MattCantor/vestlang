import { describe, it, expect } from "vitest";
import type { Installment, ResolvedInstallment } from "@vestlang/types";
import {
  runEvaluate,
  runAsOf,
  runVestedBetween,
  type GrantInput,
} from "../src";

// The three projection tools present one RESOLVED tranche per date: where two
// PLUS arms land installments on the same day, the raw per-arm stream carries
// duplicate dates, and the view boundary folds them (summing amounts) into one
// strictly date-increasing stream. evaluate's per-arm breakdown is NOT folded —
// it is the attribution view — and the valid/findings channel is untouched.

const resolved = (amount: number, date: string): Installment => ({
  state: "RESOLVED",
  amount,
  date,
});

// The RESOLVED tranche stream a tool presents, dropping any symbolic rows.
const resolvedOnly = (installments: Installment[]): ResolvedInstallment[] =>
  installments.filter((i): i is ResolvedInstallment => i.state === "RESOLVED");

// Every RESOLVED date in a stream, in order — for the strictly-increasing check.
const datesOf = (installments: Installment[]): string[] =>
  resolvedOnly(installments).map((i) => i.date);

const isStrictlyIncreasing = (dates: string[]): boolean =>
  dates.every((d, i) => i === 0 || dates[i - 1] < d);

// The RESOLVED stream each of the three tools produces for one program, so a test
// can assert they agree. The as-of and window both span the whole schedule.
function streamsFromAllTools(
  dsl: string,
  g: GrantInput,
  span: { asOf: string; from: string; to: string },
): { evaluate: Installment[]; asOf: Installment[]; window: Installment[] } {
  const ev = runEvaluate(dsl, g);
  const asOf = runAsOf(dsl, g, span.asOf);
  const window = runVestedBetween(dsl, g, span.from, span.to);
  expect(ev.ok && asOf.ok && window.ok).toBe(true);
  if (!ev.ok || !asOf.ok || !window.ok) throw new Error("unexpected failure");
  return {
    evaluate: resolvedOnly(ev.view.installments),
    asOf: asOf.vested,
    window: window.installments,
  };
}

const AT_2025_01_01: GrantInput = {
  grant_date: "2025-01-01",
  grant_quantity: 100,
};

// A recoverable pair: two identical dated grids that recovery re-infers into one
// template, so evaluate is already one-per-date; as-of and window fold to match.
const RECOVERABLE =
  "0.5 VEST FROM DATE 2025-01-01 OVER 3 months EVERY 1 month PLUS " +
  "0.5 VEST FROM DATE 2025-01-01 OVER 3 months EVERY 1 month";
const RECOVERABLE_101: GrantInput = {
  grant_date: "2025-01-01",
  grant_quantity: 101,
};

// An unrecoverable pair: overlapping dated grids on incompatible cadences (monthly
// vs every-two-months), which recovery cannot fuse — every tool folds it directly.
const UNRECOVERABLE =
  "0.5 VEST FROM DATE 2025-01-01 OVER 4 months EVERY 1 month PLUS " +
  "0.5 VEST FROM DATE 2025-01-01 OVER 4 months EVERY 2 months";

// Two-thirds twice on one date — over-allocates the grant to 133%.
const OVER_ALLOCATING =
  "2/3 VEST OVER 1 month EVERY 1 month PLUS 2/3 VEST OVER 1 month EVERY 1 month";

describe("same-date tranche fold", () => {
  it("folds a recoverable PLUS to one tranche per date across all three tools", () => {
    const expected = [
      resolved(33, "2025-02-01"),
      resolved(34, "2025-03-01"),
      resolved(34, "2025-04-01"),
    ];
    const streams = streamsFromAllTools(RECOVERABLE, RECOVERABLE_101, {
      asOf: "2025-06-01",
      from: "2025-01-01",
      to: "2025-12-31",
    });
    expect(streams.evaluate).toEqual(expected);
    expect(streams.asOf).toEqual(expected);
    expect(streams.window).toEqual(expected);
  });

  it("folds an unrecoverable events-only PLUS to one tranche per date across all three tools", () => {
    const expected = [
      resolved(12, "2025-02-01"),
      resolved(38, "2025-03-01"),
      resolved(12, "2025-04-01"),
      resolved(38, "2025-05-01"),
    ];
    const streams = streamsFromAllTools(UNRECOVERABLE, AT_2025_01_01, {
      asOf: "2025-12-31",
      from: "2025-01-01",
      to: "2025-12-31",
    });
    expect(streams.evaluate).toEqual(expected);
    expect(streams.asOf).toEqual(expected);
    expect(streams.window).toEqual(expected);

    const window = runVestedBetween(
      UNRECOVERABLE,
      AT_2025_01_01,
      "2025-01-01",
      "2025-12-31",
    );
    expect(window.ok).toBe(true);
    if (!window.ok) return;
    expect(window.tranches_in_window).toBe(4);
    expect(window.vested_in_window).toBe(100);
  });

  it("folds the unvested partition and derives next_vest_* from the folded stream", () => {
    const r = runAsOf(UNRECOVERABLE, AT_2025_01_01, "2025-02-15");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.vested).toEqual([resolved(12, "2025-02-01")]);
    expect(r.unvested).toEqual([
      resolved(38, "2025-03-01"),
      resolved(12, "2025-04-01"),
      resolved(38, "2025-05-01"),
    ]);
    // The next vest is the folded per-date total (38 = 13 + 25), not one arm's slice.
    expect(r.summary.next_vest_date).toBe("2025-03-01");
    expect(r.summary.next_vest_amount).toBe(38);
    expect(r.summary.next_vest_amount).toBe(r.unvested[0].amount);
  });

  it("folds over-allocating same-date tranches while leaving the validity channel intact", () => {
    const expected = [resolved(133, "2025-02-01")];

    const streams = streamsFromAllTools(OVER_ALLOCATING, AT_2025_01_01, {
      asOf: "2025-06-01",
      from: "2025-01-01",
      to: "2025-12-31",
    });
    expect(streams.evaluate).toEqual(expected);
    expect(streams.asOf).toEqual(expected);
    expect(streams.window).toEqual(expected);

    const ev = runEvaluate(OVER_ALLOCATING, AT_2025_01_01);
    expect(ev.ok).toBe(true);
    if (!ev.ok) return;
    // Over-allocation stays fully disclosed through valid/findings, not through
    // duplicate rows in the stream.
    expect(ev.view.valid).toBe(false);
    const overAllocation = ev.view.findings.find(
      (f) => f.kind === "over-allocation",
    );
    expect(overAllocation?.message).toContain("133% (4/3)");
    // The per-arm 66/67 split still lives in the breakdown, unfolded.
    expect(ev.breakdown.map((b) => b.installments)).toEqual([
      [resolved(66, "2025-02-01")],
      [resolved(67, "2025-02-01")],
    ]);

    const window = runVestedBetween(
      OVER_ALLOCATING,
      AT_2025_01_01,
      "2025-01-01",
      "2025-12-31",
    );
    expect(window.ok).toBe(true);
    if (!window.ok) return;
    expect(window.tranches_in_window).toBe(1);
    expect(window.valid).toBe(false);
  });

  it("never presents two RESOLVED tranches on the same date", () => {
    const programs: Array<{ dsl: string; g: GrantInput }> = [
      { dsl: RECOVERABLE, g: RECOVERABLE_101 },
      { dsl: UNRECOVERABLE, g: AT_2025_01_01 },
      { dsl: OVER_ALLOCATING, g: AT_2025_01_01 },
    ];
    for (const { dsl, g } of programs) {
      const streams = streamsFromAllTools(dsl, g, {
        asOf: "2025-12-31",
        from: "2025-01-01",
        to: "2025-12-31",
      });
      expect(isStrictlyIncreasing(datesOf(streams.evaluate))).toBe(true);
      expect(isStrictlyIncreasing(datesOf(streams.asOf))).toBe(true);
      expect(isStrictlyIncreasing(datesOf(streams.window))).toBe(true);
    }
  });

  it("leaves the per-arm breakdown unfolded on a recoverable PLUS", () => {
    const r = runEvaluate(RECOVERABLE, RECOVERABLE_101);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Two arms, each its own three-tranche grid — not collapsed into the headline.
    expect(r.breakdown.map((b) => b.installments)).toEqual([
      [
        resolved(16, "2025-02-01"),
        resolved(17, "2025-03-01"),
        resolved(17, "2025-04-01"),
      ],
      [
        resolved(17, "2025-02-01"),
        resolved(17, "2025-03-01"),
        resolved(17, "2025-04-01"),
      ],
    ]);
  });

  it("folds the dated block but leaves a trailing UNRESOLVED row in place", () => {
    const r = runEvaluate(
      "0.25 VEST FROM DATE 2025-01-01 OVER 3 months EVERY 1 month PLUS " +
        "0.25 VEST FROM DATE 2025-01-01 OVER 3 months EVERY 1 month PLUS " +
        "0.5 VEST FROM EVENT ipo OVER 3 months EVERY 1 month",
      AT_2025_01_01,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.installments).toEqual([
      resolved(16, "2025-02-01"),
      resolved(17, "2025-03-01"),
      resolved(17, "2025-04-01"),
      {
        state: "UNRESOLVED",
        amount: 50,
        symbolicDate: { type: "UNRESOLVED_VESTING_START" },
      },
    ]);
    // The unfired-event portion is still pending — folding the dated rows didn't
    // disturb the symbolic tail or its blocker.
    expect(r.view.pending).toBe(true);
    expect(r.view.pendingBlockers).toEqual([
      { type: "EVENT_NOT_YET_OCCURRED", event: "ipo" },
    ]);
  });
});
