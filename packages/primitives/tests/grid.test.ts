import { describe, it, expect } from "vitest";
import type { Fraction, OCTDate } from "@vestlang/types";
import type { BigRational } from "@vestlang/utils";
import {
  expandStatementGrid,
  type CliffInput,
  type GridParams,
} from "../src/grid";
import { expandGrid, type GridCliff, type RawEvent } from "../src/kernel";

// Unit tests for the statement→grid helper that sits above the kernel. It owns the
// CliffInput arm decision, the event-held proportional fold at max(floor, firing),
// the GridCliff construction, and the expandGrid call. These drive it directly
// across all four arms — the place the `skip` arm is reachable without contriving
// the rare end-to-end resolver state that produces it (issue #419).

// `frac` is the Number-backed input fraction (stmtFraction, cliff percentage);
// `bfrac` is the BigInt-exact BigRational a RawEvent's fractionOfGrant carries.
const frac = (numerator: number, denominator: number): Fraction => ({
  numerator,
  denominator,
});
const bfrac = (numerator: number, denominator: number): BigRational => ({
  numerator: BigInt(numerator),
  denominator: BigInt(denominator),
});
const ONE = frac(1, 1);

// A standard self-anchored monthly grid of the whole grant. anchor == origin,
// day-of-month default; the cliff is the variable under test.
const params: GridParams = {
  anchor: "2025-01-01",
  origin: "2025-01-01",
  period: 1,
  periodType: "MONTHS",
  occurrences: 4,
  stmtFraction: ONE,
  statementOrder: 1,
  dom: undefined,
};

// The helper must be a thin orchestrator: for the producing arms, its output is
// byte-identical to calling expandGrid with the GridCliff the arm builds. So we
// pin each arm against the corresponding direct kernel call.
const direct = (cliff: GridCliff): RawEvent[] =>
  expandGrid({ ...params, cliff });

describe("expandStatementGrid", () => {
  it("none → the plain even grid (no cliff lump)", () => {
    const input: CliffInput = { kind: "none" };
    expect(expandStatementGrid(params, input)).toEqual(
      direct({ kind: "none" }),
    );
    // And concretely: four equal quarter-slices, no occurrence-0 lump.
    expect(expandStatementGrid(params, input)).toEqual([
      {
        date: "2025-02-01",
        fractionOfGrant: bfrac(1, 4),
        statementOrder: 1,
        occurrence: 1,
      },
      {
        date: "2025-03-01",
        fractionOfGrant: bfrac(1, 4),
        statementOrder: 1,
        occurrence: 2,
      },
      {
        date: "2025-04-01",
        fractionOfGrant: bfrac(1, 4),
        statementOrder: 1,
        occurrence: 3,
      },
      {
        date: "2025-05-01",
        fractionOfGrant: bfrac(1, 4),
        statementOrder: 1,
        occurrence: 4,
      },
    ]);
  });

  it("fixed → a duration lump at baselineDate with the authored percentage", () => {
    const baselineDate: OCTDate = "2025-03-17";
    const input: CliffInput = {
      kind: "fixed",
      baselineDate,
      percentage: frac(1, 2),
    };
    // Identical to the kernel's fixed cliff on that date.
    expect(expandStatementGrid(params, input)).toEqual(
      direct({ kind: "fixed", date: baselineDate, percentage: frac(1, 2) }),
    );
    // The lump leads on the baseline date carrying the authored half.
    expect(expandStatementGrid(params, input)[0]).toEqual({
      date: "2025-03-17",
      fractionOfGrant: bfrac(1, 2),
      statementOrder: 1,
      occurrence: 0,
    });
  });

  it("proportional with a floor → folds at max(floor, firing), share derived from the grid", () => {
    // floor before the firing → the firing wins the fold. Two of four months
    // precede 2025-03-17, so the proportional lump is 1/2.
    const input: CliffInput = {
      kind: "proportional",
      firing: "2025-03-17",
      floor: "2025-02-10",
    };
    expect(expandStatementGrid(params, input)).toEqual(
      direct({ kind: "proportional", date: "2025-03-17" }),
    );
    expect(expandStatementGrid(params, input)[0]).toEqual({
      date: "2025-03-17",
      fractionOfGrant: bfrac(1, 2),
      statementOrder: 1,
      occurrence: 0,
    });
  });

  it("proportional where the floor is later → the floor wins the fold", () => {
    // firing 2025-02-10, floor 2025-03-17 → max is the floor. Feb 1 and Mar 1 fall
    // at or before 2025-03-17 → a 1/2 lump dated on the floor, not the earlier firing.
    const input: CliffInput = {
      kind: "proportional",
      firing: "2025-02-10",
      floor: "2025-03-17",
    };
    expect(expandStatementGrid(params, input)).toEqual(
      direct({ kind: "proportional", date: "2025-03-17" }),
    );
    // The lump dates on the floor, not the earlier firing.
    expect(expandStatementGrid(params, input)[0]?.date).toBe("2025-03-17");
  });

  it("proportional with no floor → folds at the firing alone", () => {
    const input: CliffInput = { kind: "proportional", firing: "2025-03-17" };
    expect(expandStatementGrid(params, input)).toEqual(
      direct({ kind: "proportional", date: "2025-03-17" }),
    );
  });

  it("skip → emits nothing", () => {
    expect(expandStatementGrid(params, { kind: "skip" })).toEqual([]);
  });
});
