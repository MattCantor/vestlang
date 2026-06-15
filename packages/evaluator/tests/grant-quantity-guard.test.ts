import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import type { AsOfContextInput } from "@vestlang/types";
import { evaluateProgram, evaluateProgramAsOf } from "../src/index.js";

// R2-B23: grantQuantity is policed once, at context creation, with the same
// safe-integer rule core's compile applies to totalShares. Every evaluator
// entry funnels through createEvaluationContext, so a bad share count fails
// with an input-shaped message instead of deep inside the allocation kernel.

const prog = (dsl: string) => normalizeProgram(parse(dsl));

const ctxWith = (grantQuantity: number): AsOfContextInput => ({
  grantDate: "2025-01-01",
  events: {},
  grantQuantity,
  asOf: "2026-06-01",
});

describe("grantQuantity guard at the evaluator boundary", () => {
  it("rejects an unsafe-integer grantQuantity (2^53 passes Number.isInteger)", () => {
    expect(() =>
      evaluateProgramAsOf(
        prog("VEST OVER 12 months EVERY 1 month"),
        ctxWith(2 ** 53),
      ),
    ).toThrow(/grantQuantity must be a non-negative safe integer/);
  });

  it("the resolver path enforces the same rule", () => {
    expect(() =>
      evaluateProgram(
        prog("VEST OVER 12 months EVERY 1 month"),
        ctxWith(2 ** 53),
      ),
    ).toThrow(/grantQuantity must be a non-negative safe integer/);
  });

  it("rejects a negative grantQuantity", () => {
    expect(() =>
      evaluateProgramAsOf(
        prog("VEST OVER 12 months EVERY 1 month"),
        ctxWith(-1),
      ),
    ).toThrow(/grantQuantity must be a non-negative safe integer/);
  });

  it("a zero-share grant stays legal", () => {
    const result = evaluateProgramAsOf(
      prog("VEST OVER 12 months EVERY 1 month"),
      ctxWith(0),
    );
    expect(result.unresolved).toBe(0);
  });

  it("the largest safe grant allocates exactly, under the kernel's quotient bound", () => {
    const result = evaluateProgramAsOf(
      prog("VEST OVER 12 months EVERY 1 month"),
      ctxWith(Number.MAX_SAFE_INTEGER),
    );
    const vestedTotal = result.vested.reduce((n, i) => n + i.amount, 0);
    expect(vestedTotal).toBe(Number.MAX_SAFE_INTEGER);
  });
});
