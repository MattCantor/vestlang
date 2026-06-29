import { describe, expect, it } from "vitest";
import { parse } from "@vestlang/dsl";
import { evaluateProgram } from "@vestlang/evaluator";
import { normalizeProgram } from "@vestlang/normalizer";
import type { ResolutionContextInput } from "@vestlang/types";
import { inferSchedule } from "../src/index.js";
import {
  collapseAgainstInput,
  residualAgainstInput,
  type VerifyContext,
} from "../src/verify.js";
import type { TrancheInput } from "../src/types.js";

const DOM = "VESTING_START_DAY" as const;

/** Re-evaluate an emitted DSL the way a consumer does — one collapsed program
 * walk — and sum RESOLVED installments by date. */
function collapseEval(
  dsl: string,
  ctx: ResolutionContextInput,
): Map<string, number> {
  const program = normalizeProgram(parse(dsl));
  const schedule = evaluateProgram(program, ctx);
  const byDate = new Map<string, number>();
  for (const inst of schedule.resolution.installments) {
    if (inst.state === "RESOLVED") {
      byDate.set(inst.date, (byDate.get(inst.date) ?? 0) + inst.amount);
    }
  }
  return byDate;
}

describe("inferrer reports the residual the consumer path produces (#147)", () => {
  // The issue's repro: a 360-share lump on the grant date, then 105 every three
  // days. Before #144 this round-tripped behind residualError: 0 while the
  // collapsed program re-allocated 465 onto the first date; that fix cleared the
  // divergence, and this pins that the reported residual now equals what a
  // consumer sees when it re-evaluates the emitted DSL.
  it("the lump-plus-train repro reproduces exactly and the residual agrees", () => {
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
    const byDate = collapseEval(inferred.dsl, {
      grantDate: "2025-02-01",
      events: {},
      grantQuantity: total,
      vesting_day_of_month: inferred.diagnostics.vestingDayOfMonth,
    });

    // No re-allocation onto the grant date — 360, not 360 + 105.
    expect(byDate.get("2025-02-01")).toBe(360);
    for (const t of tranches) {
      expect(byDate.get(t.date) ?? 0).toBe(t.amount);
    }

    // The reported residual is the collapse residual the consumer would compute.
    const ctx: VerifyContext = {
      grantDate: "2025-02-01",
      totalQuantity: total,
      vestingDayOfMonth: inferred.diagnostics.vestingDayOfMonth,
    };
    const program = normalizeProgram(parse(inferred.dsl));
    const { residual: collapseResidual } = collapseAgainstInput(
      program,
      tranches,
      ctx,
    );
    expect(inferred.diagnostics.residualError).toBeCloseTo(collapseResidual, 6);
  });

  // The per-statement pass and the collapse don't merely round differently — a
  // THEN chain the per-statement pass can't score at all (its tail has no anchor
  // of its own and throws) is exactly the kind of program a consumer collapses
  // without trouble. The reported residual has to come from the collapse, or a
  // chained candidate could never be scored honestly.
  it("collapse scoring handles a chain the per-statement pass cannot", () => {
    // Even halves (200 + 200 of 400). The chain's percentages store as Numeric
    // decimals, so terminating shares keep the collapse residual at zero — a
    // repeating split (2/3 + 1/3) would truncate and report a one-share residual,
    // which is real precision loss, not a scoring artifact.
    const dsl =
      "200 VEST FROM DATE 2024-01-01 OVER 2 months EVERY 1 month " +
      "THEN 200 VEST OVER 2 months EVERY 1 month";
    const program = normalizeProgram(parse(dsl));
    const input: TrancheInput[] = [
      { date: "2024-02-01", amount: 100 },
      { date: "2024-03-01", amount: 100 },
      { date: "2024-04-01", amount: 100 },
      { date: "2024-05-01", amount: 100 },
    ];
    const ctx: VerifyContext = {
      grantDate: "2024-01-01",
      totalQuantity: 400,
      vestingDayOfMonth: DOM,
    };

    expect(() => residualAgainstInput(program, input, ctx)).toThrow();

    const { residual, status } = collapseAgainstInput(program, input, ctx);
    expect(residual).toBeCloseTo(0, 6);
    expect(status).toBe("template");
  });

  // A parallel cover's reported residual must also come from the collapse. Infer
  // a stream the cover handles (no THEN), then confirm the reported number equals
  // a fresh collapse of the emitted program — not the per-statement sum the search
  // used as its pre-filter.
  it("a parallel cover reports its collapse residual", () => {
    const tranches: TrancheInput[] = [];
    for (let i = 0; i < 12; i++) {
      const month = 2 + i;
      const y = 2024 + Math.floor((month - 1) / 12);
      const m = ((month - 1) % 12) + 1;
      tranches.push({
        date: `${y}-${String(m).padStart(2, "0")}-01`,
        amount: 1000,
      });
    }

    const inferred = inferSchedule({ tranches, grantDate: "2024-02-01" });
    const program = normalizeProgram(parse(inferred.dsl));
    const total = tranches.reduce((a, t) => a + t.amount, 0);
    const ctx: VerifyContext = {
      grantDate: "2024-02-01",
      totalQuantity: total,
      vestingDayOfMonth: inferred.diagnostics.vestingDayOfMonth,
    };
    const { residual: collapseResidual } = collapseAgainstInput(
      program,
      tranches,
      ctx,
    );
    expect(inferred.diagnostics.residualError).toBeCloseTo(collapseResidual, 6);
  });
});
