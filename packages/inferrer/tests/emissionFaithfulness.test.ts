import { describe, expect, it } from "vitest";
import { evaluateProgram } from "@vestlang/evaluator";
import { stringify } from "@vestlang/render";
import type {
  OCTDate,
  Program,
  ResolutionContextInput,
  VestingDayOfMonth,
} from "@vestlang/types";
import {
  bareLumpStmt,
  cliffStmt,
  plainUniformStmt,
  thenChainProgram,
} from "../src/analytic/emit.js";
import { aggregateByDate, evalUnder, resolvedStream } from "./helpers.js";

/*
 * Render↔parse↔normalize faithfulness for the emission vocabulary.
 *
 * The analytic core builds every candidate as a typed program via these emitters,
 * renders it once with `stringify`, and verifies the RENDERED text through the
 * public pipeline. This pins that each emitted family survives that round trip:
 * build a program, render it, then parse → normalizeProgram → evaluateProgram and
 * confirm the projection is byte-for-byte the same as evaluating the built program
 * directly. If a shape rendered to text that re-read differently, the inferrer
 * would emit DSL that lies about what it computed — including the off-cadence cliff
 * shapes (any month cliff length, non-whole-multiple totals) the cliff family
 * produces.
 */

const DOM: VestingDayOfMonth = "VESTING_START_DAY";

interface Case {
  name: string;
  program: Program;
  grantDate: OCTDate;
  /** Grant quantity for the collapse — also the program's own total. */
  total: number;
}

const CASES: Case[] = [
  {
    name: "plain UNIFORM — clean monthly train",
    program: [
      plainUniformStmt(1200, "2024-01-01", { unit: "MONTHS", length: 1 }, 12),
    ],
    grantDate: "2024-01-01",
    total: 1200,
  },
  {
    // A total that doesn't divide evenly ripples the per-tranche amounts under
    // cumulative round-down (8,8,…,9,…); `total` carries the true quantity.
    name: "plain UNIFORM — ripple total (100 over 12)",
    program: [
      plainUniformStmt(100, "2024-01-01", { unit: "MONTHS", length: 1 }, 12),
    ],
    grantDate: "2024-01-01",
    total: 100,
  },
  {
    name: "SINGLE_TRANCHE — one dated lump",
    program: [bareLumpStmt(500, "2024-06-15")],
    grantDate: "2024-06-15",
    total: 500,
  },
  {
    // Today's on-cadence cliff: a one-year cliff on a monthly train (12 = 12 × 1).
    name: "CLIFF — on-cadence 12-month cliff, monthly tail",
    program: [
      cliffStmt(4800, "2024-01-01", { unit: "MONTHS", length: 1 }, 48, 12),
    ],
    grantDate: "2024-01-01",
    total: 4800,
  },
  {
    // An off-grid cliff length (5 months on an every-3-months cadence) with a
    // non-whole-multiple total — the widened vocabulary the cliff family emits.
    name: "CLIFF — off-cadence 5-month cliff on a quarterly train",
    program: [
      cliffStmt(100, "2024-01-01", { unit: "MONTHS", length: 3 }, 6, 5),
    ],
    grantDate: "2024-01-01",
    total: 100,
  },
  {
    // A per-segment-cadence THEN chain: monthly head handing off to a quarterly
    // tail on the running cursor, the shape the THEN family recovers.
    name: "THEN chain — monthly head into a quarterly tail",
    program: thenChainProgram(
      [
        { total: 300, cadence: { unit: "MONTHS", length: 1 }, occurrences: 3 },
        { total: 200, cadence: { unit: "MONTHS", length: 3 }, occurrences: 2 },
      ],
      "2024-01-01",
    ),
    grantDate: "2024-01-01",
    total: 500,
  },
];

describe("emission faithfulness: build → render → parse → normalize → evaluate", () => {
  for (const { name, program, grantDate, total } of CASES) {
    it(name, () => {
      const dsl = stringify(program);

      // Oracle: evaluate the built program directly, the way the verifier scores a
      // candidate.
      const ctx: ResolutionContextInput = {
        grantDate,
        events: {},
        grantQuantity: total,
        vesting_day_of_month: DOM,
      };
      const direct = evaluateProgram(program, ctx);

      // Under test: the rendered DSL back through the independent public pipeline.
      const roundTrip = evalUnder(dsl, grantDate, total, DOM);

      // Both readings must land as a single storable template, and their per-date
      // projections must agree exactly.
      expect(direct.resolution.status).toBe("template");
      expect(roundTrip.resolution.status).toBe("template");

      const directProjection = aggregateByDate(resolvedStream(direct));
      const roundTripProjection = aggregateByDate(resolvedStream(roundTrip));
      expect(roundTripProjection).toEqual(directProjection);

      // Sanity: the projection conserves the program's total.
      const projected = directProjection.reduce((a, t) => a + t.total, 0);
      expect(projected).toBe(total);
    });
  }
});
