import { describe, expect, it } from "vitest";
import type { OCTDate, VestingDayOfMonth } from "@vestlang/types";
import { inferSchedule } from "../src/index.js";
import { aggregateByDate, evalUnder, resolvedStream } from "./helpers.js";

/*
 * Crash containment for inferSchedule.
 *
 * The inferrer scores candidates by round-tripping each one back through the
 * evaluator, and a candidate whose grid drives the exact-integer allocator past
 * Number.MAX_SAFE_INTEGER makes that inner evaluate THROW. An uncontained throw
 * escapes inferSchedule entirely, so a caller handing over a perfectly ordinary
 * resolved stream gets an exception instead of a decomposition.
 *
 * These three streams each reach a throwing candidate on the scoring path. The
 * fix contains the throw at the scoring boundary (a throwing candidate simply
 * loses), so inferSchedule returns a valid cover. We assert both halves: it does
 * not throw, and the cover it returns reproduces the input per-date totals when
 * re-evaluated under its own reported day-of-month.
 */

interface Case {
  name: string;
  dsl: string;
  grantDate: OCTDate;
  total: number;
  dom: VestingDayOfMonth;
}

// Each of these once escaped inferSchedule as a MAX_SAFE_INTEGER allocator throw
// raised inside candidate scoring — a 48-over-1 with a 12-month cliff (from grant
// and backdated), and a 12-over-1 with a 6-month cliff on a month-end start under
// the MINUS_ONE day-of-month convention.
const CASES: Case[] = [
  {
    name: "48-over-1 with a 12mo cliff, from grant",
    dsl: "1070 VEST OVER 48 months EVERY 1 months CLIFF 12 months",
    grantDate: "2024-01-01",
    total: 1070,
    dom: "VESTING_START_DAY",
  },
  {
    name: "48-over-1 with a 12mo cliff, backdated start",
    dsl: "1070 VEST FROM DATE 2024-01-01 OVER 48 months EVERY 1 months CLIFF 12 months",
    grantDate: "2024-07-01",
    total: 1070,
    dom: "VESTING_START_DAY",
  },
  {
    name: "12-over-1 with a 6mo cliff, month-end start, MINUS_ONE dom",
    dsl: "97 VEST OVER 12 months EVERY 1 months CLIFF 6 months",
    grantDate: "2024-01-31",
    total: 97,
    dom: "VESTING_START_DAY_MINUS_ONE",
  },
];

describe("inferSchedule crash containment", () => {
  it.each(CASES)(
    "$name: does not throw and reproduces the per-date totals",
    ({ dsl, grantDate, total, dom }) => {
      const original = aggregateByDate(
        resolvedStream(evalUnder(dsl, grantDate, total, dom)),
      );

      let result: ReturnType<typeof inferSchedule> | undefined;
      expect(() => {
        result = inferSchedule({
          tranches: original.map(({ date, total }) => ({
            date,
            amount: total,
          })),
          grantDate,
        });
      }).not.toThrow();

      // Re-evaluate the returned cover through the independent public pipeline
      // under the day-of-month it reported, and the per-date totals must match.
      const recovered = aggregateByDate(
        resolvedStream(
          evalUnder(
            result!.dsl,
            grantDate,
            total,
            result!.diagnostics.vestingDayOfMonth,
          ),
        ),
      );
      expect(recovered).toEqual(original);
    },
  );
});

describe("inferSchedule degradation on an unverifiable stream", () => {
  // Irregular gaps and non-monotone amounts, so no template family (plain, cliff,
  // fold, or per-segment THEN) reproduces the stream. Whether the scan ends by
  // exhausting the candidates or by hitting the internal work bound, the result is
  // the same, and unobservable from here — so this pins the OUTCOME: the scan
  // terminates (no hang) and returns the projection-lossless literal fallback.
  const UNVERIFIABLE = [
    { date: "2024-01-05", amount: 700 },
    { date: "2024-02-19", amount: 300 },
    { date: "2024-05-02", amount: 1100 },
    { date: "2024-06-11", amount: 450 },
    { date: "2024-09-23", amount: 900 },
    { date: "2024-12-07", amount: 250 },
  ] as const;

  it("terminates and returns the literal fallback", () => {
    const tranches = UNVERIFIABLE.map((t) => ({
      date: t.date,
      amount: t.amount,
    }));
    const grantDate = tranches[0].date;
    const total = tranches.reduce((s, t) => s + t.amount, 0);

    let result: ReturnType<typeof inferSchedule> | undefined;
    expect(() => {
      result = inferSchedule({ tranches, grantDate });
    }).not.toThrow();

    expect(result!.diagnostics.fallback).toBe(true);
    expect(result!.decomposition.every((c) => c.tag === "literal")).toBe(true);

    // Projection-lossless: the emitted per-date lumps re-evaluate to the input
    // per-date totals under the reported day-of-month.
    const recovered = aggregateByDate(
      resolvedStream(
        evalUnder(
          result!.dsl,
          grantDate,
          total,
          result!.diagnostics.vestingDayOfMonth,
        ),
      ),
    );
    expect(recovered).toEqual(aggregateByDate(tranches));
  });
});
