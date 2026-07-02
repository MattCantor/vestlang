import { describe, expect, it } from "vitest";
import { parse } from "@vestlang/dsl";
import { evaluateProgram } from "@vestlang/evaluator";
import { normalizeProgram } from "@vestlang/normalizer";
import type {
  EvaluatedSchedule,
  Installment,
  OCTDate,
  ResolutionContextInput,
  ResolvedInstallment,
  VestingDayOfMonth,
} from "@vestlang/types";
import { inferSchedule } from "../src/index.js";

/*
 * Crash containment for inferSchedule (issue #489).
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

function evalUnder(
  dsl: string,
  grantDate: OCTDate,
  total: number,
  dom: VestingDayOfMonth,
): EvaluatedSchedule {
  const program = normalizeProgram(parse(dsl));
  const ctx: ResolutionContextInput = {
    grantDate,
    events: {},
    grantQuantity: total,
    vesting_day_of_month: dom,
  };
  return evaluateProgram(program, ctx);
}

function resolvedStream(
  sched: EvaluatedSchedule,
): { date: OCTDate; amount: number }[] {
  const items: Installment[] = sched.resolution.installments;
  return items
    .filter((i): i is ResolvedInstallment => i.state === "RESOLVED")
    .map((i) => ({ date: i.date, amount: i.amount }));
}

function aggregate(
  stream: { date: OCTDate; amount: number }[],
): { date: OCTDate; total: number }[] {
  const byDate = new Map<OCTDate, number>();
  for (const { date, amount } of stream)
    byDate.set(date, (byDate.get(date) ?? 0) + amount);
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, total]) => ({ date, total }));
}

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
      const original = aggregate(
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
      const recovered = aggregate(
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
