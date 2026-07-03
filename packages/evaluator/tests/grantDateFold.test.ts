import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import type { ResolutionContextInput } from "@vestlang/types";
import { evaluateProgram } from "../src/index.js";

const ctx: ResolutionContextInput = {
  grantDate: "2025-02-01",
  grantQuantity: 1000,
  events: {},
};

const prog = (dsl: string) => normalizeProgram(parse(dsl));

describe("grant-date fold across statements", () => {
  it("telescopes two halves landing on the grant date to exactly the grant (#144)", () => {
    // Both halves emit on the grant date, as separate entries. The grant-date
    // fold must not re-emit the first half against the second.
    const res = evaluateProgram(prog("0.5 VEST PLUS 0.5 VEST"), ctx);
    const installments = res.resolvesTo.installments;
    const sum = installments.reduce((a, i) => a + i.amount, 0);
    expect(sum).toBe(1000);
  });
});
