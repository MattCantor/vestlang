// A QUANTITY claim on the symbolic/as-of side is a claim on the grant and can
// never exceed it. Before the fix the authored count came back raw: 150
// unresolved on a 100-share grant, 100 invented on a zero-share grant — while
// the template arm's amountToFraction clamped the same inputs.

import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram } from "../src/evaluate";
import { evaluateProgramAsOf } from "../src/asof";

describe("QUANTITY claim capped at the grant", () => {
  // Repro 1: a pending event-gated start with an over-grant authored quantity.
  // Post-#216 this resolves to a template verdict whose pending share claim rides
  // as one symbolic UNRESOLVED lump.
  it("resolver: pending lump is capped at the grant, not the authored value", () => {
    const program = normalizeProgram(
      parse("150 VEST FROM EVENT a OVER 2 months EVERY 1 month"),
    );
    const ctx = {
      grantDate: "2024-01-01",
      events: {},
      grantQuantity: 100,
    };

    const schedule = evaluateProgram(program, ctx);
    expect(schedule.resolvesTo.status).toBe("template");
    expect(schedule.resolvesTo.installments).toHaveLength(1);
    const [lump] = schedule.resolvesTo.installments;
    expect(lump.state).toBe("UNRESOLVED");
    expect(lump.amount).toBe(100); // capped: the grant only has 100
  });

  // The cap must not mask the over-allocation finding — the authored 150 of 100
  // is still invalid and the error must be present.
  it("the over-allocation finding is not masked by the cap", () => {
    const program = normalizeProgram(
      parse("150 VEST FROM EVENT a OVER 2 months EVERY 1 month"),
    );
    const ctx = {
      grantDate: "2024-01-01",
      events: {},
      grantQuantity: 100,
    };

    const schedule = evaluateProgram(program, ctx);
    expect(schedule.findings).toEqual([
      expect.objectContaining({
        kind: "over-allocation",
        severity: "error",
        sum: { numerator: 3, denominator: 2 },
      }),
    ]);
  });

  // The same program seen through the as-of surface: everything unresolved,
  // but the tally is the grant cap, not 150.
  it("as-of: unresolved tallies 100, not 150", () => {
    const program = normalizeProgram(
      parse("150 VEST FROM EVENT a OVER 2 months EVERY 1 month"),
    );
    const result = evaluateProgramAsOf(program, {
      grantDate: "2024-01-01",
      events: {},
      grantQuantity: 100,
      asOf: "2026-06-01",
    });

    expect(result.vested).toHaveLength(0);
    expect(result.unvested).toHaveLength(0);
    expect(result.impossible).toHaveLength(0);
    expect(result.unresolved).toBe(100); // was 150
  });

  // Repro 2 (zero-share grant): the two tools used to tell contradictory stories —
  // evaluateProgram said valid: true + empty installments while evaluateProgramAsOf
  // reported 100 unresolved shares of nothing. Both should agree at 0.
  it("zero-share grant: evaluateProgram and evaluateProgramAsOf both tally 0", () => {
    const program = normalizeProgram(
      parse("100 VEST OVER 2 months EVERY 1 month"),
    );
    const ctx = {
      grantDate: "2024-01-01",
      events: {},
      grantQuantity: 0,
      asOf: "2026-06-01",
    };

    // evaluateProgram: template verdict, empty installments, no findings — the
    // QUANTITY lowers to ZERO against a zero-share grant, so the sum is 0, well
    // within the grant, not an over-allocation.
    const schedule = evaluateProgram(program, ctx);
    expect(schedule.resolvesTo.status).toBe("template");
    expect(schedule.resolvesTo.installments).toHaveLength(0);
    expect(schedule.findings).toHaveLength(0);

    // evaluateProgramAsOf: nothing in any bucket
    const result = evaluateProgramAsOf(program, ctx);
    expect(result.unresolved).toBe(0); // was 100
    expect(result.vested).toHaveLength(0);
    expect(result.unvested).toHaveLength(0);
    expect(result.impossible).toHaveLength(0);
  });

  // Within-grant QUANTITY: the cap is a no-op and nothing moves.
  it("within-grant QUANTITY is unchanged", () => {
    const program = normalizeProgram(
      parse("60 VEST FROM EVENT a OVER 2 months EVERY 1 month"),
    );
    const result = evaluateProgramAsOf(program, {
      grantDate: "2024-01-01",
      events: {},
      grantQuantity: 100,
      asOf: "2026-06-01",
    });

    expect(result.unresolved).toBe(60);
  });

  // Boundary marker: capping the claim channel does NOT mean capping the dated
  // compiled output. A fired over-allocating program still telescopes to 150
  // dated shares under valid: false — that boundary (#222) belongs to the kernel,
  // not the claim channel. This test pins the current behavior so it's obvious
  // if someone inadvertently reaches into the dated path.
  it("boundary marker: dated compiled path is not capped (that is #222's seam)", () => {
    const program = normalizeProgram(
      parse("150 VEST OVER 2 months EVERY 1 month"),
    );
    const ctx = {
      grantDate: "2024-01-01",
      events: {},
      grantQuantity: 100,
    };

    const schedule = evaluateProgram(program, ctx);
    // The compiled projection delivers 75 + 75 = 150 under an error finding.
    expect(schedule.resolvesTo.installments).toEqual([
      { state: "RESOLVED", amount: 75, date: "2024-02-01" },
      { state: "RESOLVED", amount: 75, date: "2024-03-01" },
    ]);
    expect(schedule.findings).toEqual([
      expect.objectContaining({ kind: "over-allocation", severity: "error" }),
    ]);
  });
});
