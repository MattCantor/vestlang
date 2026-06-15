// A non-divisible PORTION (1/3 of 100) sized by the symbolic arm must stay an
// integer share claim: floor(grant × fraction), consistent with how the template
// arm tallies the same statement. Before the fix the float 33.33… crashed
// allocateVector's BigInt() and leaked fractional installment amounts.

import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram } from "../src/evaluate/index";
import { evaluateProgramAsOf } from "../src/asof";

const isInt = (n: number) => Number.isInteger(n);

describe("non-divisible PORTION in the symbolic arm", () => {
  // The issue repro: a 1/3 portion with a gated cliff stays unresolved, so the
  // symbolic arm sizes it. It used to throw RangeError out of BigInt(33.33…).
  it("does not crash on a 1/3 portion with a gated cliff", () => {
    const program = normalizeProgram(
      parse(
        "1/3 VEST OVER 12 months EVERY 1 month CLIFF EVENT board AFTER DATE 2026-01-01",
      ),
    );

    const run = () =>
      evaluateProgram(program, {
        grantDate: "2025-01-01",
        events: {},
        grantQuantity: 100,
      });

    expect(run).not.toThrow();

    const [{ resolution }] = run();
    expect(resolution.installments.every((i) => isInt(i.amount))).toBe(true);
  });

  // Published installment amounts must be whole shares — no 33.33333333333333.
  it("publishes only integer installment amounts", () => {
    const program = normalizeProgram(
      parse(
        "1/3 VEST OVER 12 months EVERY 1 month CLIFF EVENT board AFTER DATE 2026-01-01",
      ),
    );
    const [{ resolution }] = evaluateProgram(program, {
      grantDate: "2025-01-01",
      events: {},
      grantQuantity: 100,
    });

    expect(resolution.installments.length).toBeGreaterThan(0);
    for (const inst of resolution.installments) {
      expect(isInt(inst.amount)).toBe(true);
    }
  });

  // The per-statement floor (33 × 3 = 99) is superseded by the program-wide
  // cumulative claim (R2-B20) — the tally now matches what the allocator
  // delivers once a/b/c fire.
  it("tallies the telescoped as-of unresolved total (100, not 3 × floor = 99)", () => {
    const program = normalizeProgram(
      parse(
        "1/3 VEST FROM EVENT a OVER 12 months EVERY 1 month " +
          "PLUS 1/3 VEST FROM EVENT b OVER 12 months EVERY 1 month " +
          "PLUS 1/3 VEST FROM EVENT c OVER 12 months EVERY 1 month",
      ),
    );

    const result = evaluateProgramAsOf(program, {
      grantDate: "2025-01-01",
      events: {},
      grantQuantity: 100,
      asOf: "2025-06-01",
    });

    expect(isInt(result.unresolved)).toBe(true);
    expect(result.unresolved).toBe(100);
  });
});
