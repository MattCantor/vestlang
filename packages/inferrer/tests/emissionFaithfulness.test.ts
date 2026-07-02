import { describe, expect, it } from "vitest";
import { evaluateProgram } from "@vestlang/evaluator";
import { stringify } from "@vestlang/render";
import type {
  OCTDate,
  ResolutionContextInput,
  VestingDayOfMonth,
} from "@vestlang/types";
import { buildStatement } from "../src/atoms.js";
import type { Component } from "../src/types.js";
import { aggregateByDate, evalUnder, resolvedStream } from "./helpers.js";

/*
 * Render↔parse↔normalize faithfulness for the emission vocabulary.
 *
 * Stage 2a widens `CliffUniformComponent` to carry any cliff length (off the
 * installment grid) and a statement's true total, ahead of the analytic core that
 * relies on both. Before anything leans on the widened shape, this pins that every
 * family the atoms builders emit survives a full round trip through the public
 * pipeline: build a statement, render it to DSL exactly as `infer.ts` does
 * (`stringify`), then parse → normalizeProgram → evaluateProgram and confirm the
 * projection is byte-for-byte the same as evaluating the built statement directly.
 * If a shape rendered to text that re-read differently, the inferrer would emit
 * DSL that lies about what it computed — this catches that at the vocabulary
 * boundary, including the off-cadence cliff shapes stage 2b will start producing.
 */

const DOM: VestingDayOfMonth = "VESTING_START_DAY";

interface Case {
  name: string;
  component: Component;
  grantDate: OCTDate;
  /** Grant quantity for the collapse — also the statement's own total. */
  total: number;
}

const CASES: Case[] = [
  {
    name: "UNIFORM — clean monthly train",
    component: {
      kind: "UNIFORM",
      startDate: "2024-02-01",
      cadence: { unit: "MONTHS", length: 1 },
      occurrences: 12,
      perTrancheAmount: 100,
      total: 1200,
    },
    grantDate: "2024-01-01",
    total: 1200,
  },
  {
    // A total that doesn't divide evenly across the train: cumulative round-down
    // ripples the per-tranche amounts (8,8,…,9,…), so the total is not a clean
    // multiple of any single rate. `total` has to carry it faithfully.
    name: "UNIFORM — ripple total (100 over 12)",
    component: {
      kind: "UNIFORM",
      startDate: "2024-02-01",
      cadence: { unit: "MONTHS", length: 1 },
      occurrences: 12,
      perTrancheAmount: 8,
      total: 100,
    },
    grantDate: "2024-01-01",
    total: 100,
  },
  {
    name: "SINGLE_TRANCHE — one dated lump",
    component: { kind: "SINGLE_TRANCHE", date: "2024-06-15", amount: 500 },
    grantDate: "2024-06-15",
    total: 500,
  },
  {
    // Today's on-cadence cliff: a one-year cliff on a monthly train. The cliff
    // length is a whole multiple of the cadence (12 = 12 × 1), so this is the
    // exact shape the folds emit now — the identity case for the atoms change.
    name: "CLIFF_UNIFORM — on-cadence 12-month cliff, monthly tail",
    component: {
      kind: "CLIFF_UNIFORM",
      grantDate: "2024-01-01",
      cadence: { unit: "MONTHS", length: 1 },
      cliffSteps: 12,
      tailOccurrences: 36,
      perTrancheAmount: 100,
      total: 4800,
      cliffLength: 12,
    },
    grantDate: "2024-01-01",
    total: 4800,
  },
  {
    // The shape stage 2b will produce and 2a can't reach through the folds: a
    // cliff length off the installment grid (5 months on an every-3-months
    // cadence) with a non-whole-multiple total. Constructed directly to prove the
    // widened vocabulary renders and re-parses faithfully now, before any search
    // path emits it.
    name: "CLIFF_UNIFORM — off-cadence 5-month cliff on a quarterly train",
    component: {
      kind: "CLIFF_UNIFORM",
      grantDate: "2024-01-01",
      cadence: { unit: "MONTHS", length: 3 },
      cliffSteps: 2,
      tailOccurrences: 4,
      perTrancheAmount: 16,
      total: 100,
      cliffLength: 5,
    },
    grantDate: "2024-01-01",
    total: 100,
  },
];

describe("emission faithfulness: build → render → parse → normalize → evaluate", () => {
  for (const { name, component, grantDate, total } of CASES) {
    it(name, () => {
      const stmt = buildStatement(component, DOM);
      const dsl = stringify([stmt]);

      // Oracle: evaluate the built statement directly, the way `verify.ts` scores
      // a candidate program.
      const ctx: ResolutionContextInput = {
        grantDate,
        events: {},
        grantQuantity: total,
        vesting_day_of_month: DOM,
      };
      const direct = evaluateProgram([stmt], ctx);

      // Under test: the rendered DSL back through the independent public pipeline.
      const roundTrip = evalUnder(dsl, grantDate, total, DOM);

      // Both readings must land as a single storable template, and their
      // per-date projections must agree exactly.
      expect(direct.resolution.status).toBe("template");
      expect(roundTrip.resolution.status).toBe("template");

      const directProjection = aggregateByDate(resolvedStream(direct));
      const roundTripProjection = aggregateByDate(resolvedStream(roundTrip));
      expect(roundTripProjection).toEqual(directProjection);

      // Sanity: the projection conserves the statement's total.
      const projected = directProjection.reduce((a, t) => a + t.total, 0);
      expect(projected).toBe(total);
    });
  }
});
