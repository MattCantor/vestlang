// The as-of partition carries the schedule's findings unchanged. An
// over-allocation (the program allocates more than the whole grant) is about the
// spec as written, not about where the partition is cut, so it rides onto the
// VestedResult raw — the same finding evaluateProgram reports — for the read
// surfaces to format and gate on.

import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgramAsOf } from "../src/asof";

const run = (
  dsl: string,
  grantQuantity: number,
  asOf: string,
  events: Record<string, string> = {},
) =>
  evaluateProgramAsOf(normalizeProgram(parse(dsl)), {
    grantDate: "2025-01-01",
    events,
    grantQuantity,
    asOf,
  });

describe("evaluateProgramAsOf carries the schedule's findings", () => {
  // Two 0.6 grids on the same grant reach 120% (6/5). These resolve to bare
  // dated events (two overlapping absolute grids can't be one template), so this
  // pins the finding survives on the events-only arm too.
  it("an over-allocating events-only program reports the over-allocation finding", () => {
    const result = run(
      "0.6 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month PLUS " +
        "0.6 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month",
      1200,
      "2027-01-01",
    );
    expect(result.findings).toEqual([
      expect.objectContaining({
        kind: "over-allocation",
        severity: "error",
        sum: { numerator: 6, denominator: 5 },
      }),
    ]);
  });

  // A single absolute-quantity statement that exceeds the grant: 1500 of 1200 is
  // 125% (5/4) and stays one clean template. (A single *fraction* can't
  // over-allocate — the parser caps a portion at ≤ 1 — so the over-allocator
  // here is an absolute count.)
  it("an over-allocating template program reports the over-allocation finding", () => {
    const result = run(
      "1500 VEST OVER 12 months EVERY 1 month",
      1200,
      "2027-01-01",
    );
    expect(result.findings).toEqual([
      expect.objectContaining({
        kind: "over-allocation",
        severity: "error",
        sum: { numerator: 5, denominator: 4 },
      }),
    ]);
  });

  // A within-grant program has nothing to flag — the findings array is empty.
  it("a valid program carries no findings", () => {
    const result = run("VEST OVER 12 months EVERY 1 month", 1200, "2027-01-01");
    expect(result.findings).toEqual([]);
  });
});
