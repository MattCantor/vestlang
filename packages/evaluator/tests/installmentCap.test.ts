import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import type { EvaluationContextInput } from "@vestlang/types";
import { evaluateStatements, evaluateStatementsAsOf } from "../src/index.js";

// The per-statement program evaluators own the installment cap. Every
// per-statement consumer (CLI, MCP `vestlang_evaluate` family) routes through
// them, so the cap can't be hand-rolled away — these tests pin that the cap
// lives here, spanning the whole program rather than a single statement.

const ctx: EvaluationContextInput = {
  events: { grantDate: "2025-01-01" },
  grantQuantity: 1000,
  asOf: "2025-06-01",
  vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
};

const prog = (dsl: string) => normalizeProgram(parse(dsl));

describe("evaluateStatements / evaluateStatementsAsOf — installment cap", () => {
  it("rejects a single over-cap statement", () => {
    expect(() =>
      evaluateStatements(prog("VEST OVER 1000000 months EVERY 1 month"), ctx),
    ).toThrow(/exceeds the limit/);
  });

  it("rejects a program whose statements sum over the cap", () => {
    expect(() =>
      evaluateStatements(
        prog(
          "VEST OVER 6000 days EVERY 1 day PLUS VEST OVER 6000 days EVERY 1 day",
        ),
        ctx,
      ),
    ).toThrow(/exceeds the limit/);
  });

  it("the as-of sibling enforces the same cap", () => {
    expect(() =>
      evaluateStatementsAsOf(
        prog(
          "VEST OVER 6000 days EVERY 1 day PLUS VEST OVER 6000 days EVERY 1 day",
        ),
        ctx,
      ),
    ).toThrow(/exceeds the limit/);
  });

  it("evaluates an ordinary program — one result per statement", () => {
    const res = evaluateStatements(
      prog(
        "VEST OVER 48 months EVERY 1 month PLUS VEST OVER 12 months EVERY 1 month",
      ),
      ctx,
    );
    expect(res).toHaveLength(2);
    expect(res[0].installments).toHaveLength(48);
    expect(res[1].installments).toHaveLength(12);
  });
});
