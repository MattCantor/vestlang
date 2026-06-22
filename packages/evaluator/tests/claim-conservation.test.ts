// R2-B20 — symbolic claims draw from one program-wide cumulative (dated basis
// first, live pending in program order, void last, clamped at the grant), so
// pending + dated + impossible telescope instead of summing independent floors.

import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram } from "../src/orchestrate";
import { evaluateProgramAsOf } from "../src/asof";

describe("claim conservation (R2-B20)", () => {
  // A single statement is unchanged: one draw from a fresh cursor is exactly
  // floor(grant × fraction), the same as the old per-statement floor.
  it("single statement is byte-identical to the old per-statement floor", () => {
    const program = normalizeProgram(
      parse("1/3 VEST FROM EVENT a OVER 1 month EVERY 1 month"),
    );
    const ctx = {
      grantDate: "2024-01-01",
      events: {},
      grantQuantity: 100,
      asOf: "2026-01-01",
    };
    expect(evaluateProgramAsOf(program, ctx).unresolved).toBe(33);
  });

  // The headline fix: three pending thirds on 100 shares now tally 100, not 99.
  // Three distinct event starts are more than one start origin, so canonical
  // can't hoist them all onto its single contingent start — the program lands
  // in the events-only arm (MULTIPLE_START_ORIGINS). The three lumps still
  // telescope to UNRESOLVED [33, 33, 34], the remainder riding the last one.
  it("headline: three pending thirds on 100 shares tally [33, 33, 34] via evaluateProgram", () => {
    const program = normalizeProgram(
      parse(
        "1/3 VEST FROM EVENT a OVER 1 month EVERY 1 month " +
          "PLUS 1/3 VEST FROM EVENT b OVER 1 month EVERY 1 month " +
          "PLUS 1/3 VEST FROM EVENT c OVER 1 month EVERY 1 month",
      ),
    );
    const ctx = {
      grantDate: "2024-01-01",
      events: {},
      grantQuantity: 100,
    };

    const { resolution } = evaluateProgram(program, ctx);
    expect(resolution.status).toBe("events-only");
    // Distinct event origins can't share canonical's single hoisted start, so the
    // events-only arm carries the MULTIPLE_START_ORIGINS reason (AC 6).
    if (resolution.status === "events-only") {
      expect(resolution.reason.kind).toBe("MULTIPLE_START_ORIGINS");
    }
    expect(resolution.installments.map((i) => i.amount)).toEqual([33, 33, 34]);
  });

  // Same program, as-of surface: the cumulative tally is 100 unresolved.
  it("headline: three pending thirds tally 100 unresolved via evaluateProgramAsOf", () => {
    const program = normalizeProgram(
      parse(
        "1/3 VEST FROM EVENT a OVER 1 month EVERY 1 month " +
          "PLUS 1/3 VEST FROM EVENT b OVER 1 month EVERY 1 month " +
          "PLUS 1/3 VEST FROM EVENT c OVER 1 month EVERY 1 month",
      ),
    );
    const ctx = {
      grantDate: "2024-01-01",
      events: {},
      grantQuantity: 100,
      asOf: "2026-01-01",
    };
    const result = evaluateProgramAsOf(program, ctx);
    expect(result.unresolved).toBe(100);
    expect(result.vested).toHaveLength(0);
    expect(result.unvested).toHaveLength(0);
    expect(result.impossible).toHaveLength(0);
  });

  // The pending-side total in the test above is the same number the allocator
  // delivers once all three events fire — that's the conservation claim.
  it("pending total equals delivered total once all events fire", () => {
    const program = normalizeProgram(
      parse(
        "1/3 VEST FROM EVENT a OVER 1 month EVERY 1 month " +
          "PLUS 1/3 VEST FROM EVENT b OVER 1 month EVERY 1 month " +
          "PLUS 1/3 VEST FROM EVENT c OVER 1 month EVERY 1 month",
      ),
    );
    const ctx = {
      grantDate: "2024-01-01",
      events: { a: "2024-03-10", b: "2024-03-10", c: "2024-03-10" },
      grantQuantity: 100,
      asOf: "2026-01-01",
    };
    const result = evaluateProgramAsOf(program, ctx);
    const vestedTotal = result.vested.reduce((n, i) => n + i.amount, 0);
    expect(vestedTotal).toBe(100); // same-date ties break by statement order: 33, 33, 34
    expect(result.unresolved).toBe(0);
  });

  // The dated basis is the summed fraction of all dated statements, regardless of
  // where they sit in program order. The pending clause is FIRST here yet still
  // claims the remainder (34), because the dated allocator already telescoped the
  // 2/3 portion's 66 shares jointly. A dated start beside an event start is two
  // distinct start origins, so the program lands in the events-only arm rather
  // than a single hoisted template.
  it("mixed dated + pending: basis is the dated set's fraction, not a textual prefix", () => {
    const program = normalizeProgram(
      parse(
        "1/3 VEST FROM EVENT a OVER 1 month EVERY 1 month " +
          "PLUS 2/3 VEST OVER 2 months EVERY 1 month",
      ),
    );
    const ctx = {
      grantDate: "2024-01-01",
      events: {},
      grantQuantity: 100,
      asOf: "2026-01-01",
    };

    const { resolution } = evaluateProgram(program, ctx);
    expect(resolution.status).toBe("events-only");
    // Dated tranches first: 33 @ 2024-02-01, 33 @ 2024-03-01; then pending: 34.
    expect(resolution.installments).toEqual([
      { state: "RESOLVED", amount: 33, date: "2024-02-01" },
      { state: "RESOLVED", amount: 33, date: "2024-03-01" },
      expect.objectContaining({ state: "UNRESOLVED", amount: 34 }),
    ]);

    const asof = evaluateProgramAsOf(program, ctx);
    expect(asof.vested.reduce((n, i) => n + i.amount, 0)).toBe(66);
    expect(asof.unresolved).toBe(34);
  });

  // A THEN chain: head and tail are both pending on the event, but together they
  // telescope. The tail re-sizes from 66 to 67 so the pair sums to 100.
  it("THEN chain telescopes: [33, 67], sum 100", () => {
    const program = normalizeProgram(
      parse(
        "1/3 VEST FROM EVENT ipo OVER 1 month EVERY 1 month " +
          "THEN 2/3 VEST OVER 1 month EVERY 1 month",
      ),
    );
    const ctx = {
      grantDate: "2024-01-01",
      events: {},
      grantQuantity: 100,
      asOf: "2026-01-01",
    };

    const { resolution } = evaluateProgram(program, ctx);
    // A THEN chain headed on one event is now a single hoisted template
    // (re-anchored to the resolved date on firing), not unresolved.
    expect(resolution.status).toBe("template");
    expect(resolution.installments.map((i) => i.amount)).toEqual([33, 67]);

    const asof = evaluateProgramAsOf(program, ctx);
    expect(asof.unresolved).toBe(100);
  });

  // An over-allocated pending program: claims are clamped to the grant. The
  // finding is still present — the cap is a claim-channel discipline, not a
  // correctness declaration. Two distinct event starts are more than one start
  // origin, so the verdict is events-only rather than a hoisted template.
  it("over-allocated pending program: lumps [75, 25], sum 100, finding preserved", () => {
    const program = normalizeProgram(
      parse(
        "3/4 VEST FROM EVENT a OVER 1 month EVERY 1 month " +
          "PLUS 3/4 VEST FROM EVENT b OVER 1 month EVERY 1 month",
      ),
    );
    const ctx = {
      grantDate: "2024-01-01",
      events: {},
      grantQuantity: 100,
      asOf: "2026-01-01",
    };

    const { resolution, findings } = evaluateProgram(program, ctx);
    expect(resolution.status).toBe("events-only");
    expect(resolution.installments.map((i) => i.amount)).toEqual([75, 25]);

    const asof = evaluateProgramAsOf(program, ctx);
    expect(asof.unresolved).toBe(100);

    expect(findings).toContainEqual(
      expect.objectContaining({
        kind: "over-allocation",
        severity: "error",
        sum: { numerator: 3, denominator: 2 },
      }),
    );
  });

  // Void portions draw last, so a dead clause ahead of a live one can't deflate
  // the live one's claim. The live b-clause gets floor(100 × 2/3) = 66 — exactly
  // what the allocator will deliver when b fires alone. The impossible a-clause
  // takes the clamped remainder (34).
  it("void portions draw last: live claim undeflated by a preceding impossible clause", () => {
    const program = normalizeProgram(
      parse(
        "2/3 VEST FROM EVENT a BEFORE DATE 2025-01-01 OVER 1 month EVERY 1 month " +
          "PLUS 2/3 VEST FROM EVENT b OVER 1 month EVERY 1 month",
      ),
    );
    // a fired after its BEFORE deadline → dead start; b unfired → live
    const ctx = {
      grantDate: "2025-01-01",
      events: { a: "2025-06-01" },
      grantQuantity: 100,
      asOf: "2026-01-01",
    };

    const { resolution } = evaluateProgram(program, ctx);
    expect(resolution.status).toBe("unresolved");
    // In program order: impossible a (34), unresolved b (66).
    // The live portion's 66 is undeflated by the dead clause ahead of it.
    expect(resolution.installments).toEqual([
      expect.objectContaining({ state: "IMPOSSIBLE", amount: 34 }),
      expect.objectContaining({ state: "UNRESOLVED", amount: 66 }),
    ]);

    // partitionAsOf folds impossible amounts into unresolved (preexisting semantics)
    const asof = evaluateProgramAsOf(program, ctx);
    expect(asof.impossible.reduce((n, i) => n + i.amount, 0)).toBe(34);
    expect(asof.unresolved).toBe(100);
  });
});
