import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { compile } from "@vestlang/core";
import { resolveToCore } from "../src/resolve/index";
import { evaluateProgram } from "../src/evaluate";

// #413/#415 — schedule-whole storage of the statement percentages.
//
// Three exact thirds mean to vest the whole grant. Stored one at a time none of
// them can write a third exactly, the set drifts off 1, and the single-cumulative
// allocator floors a share away. Apportioning the set together — rounding the
// schedule's running total to the storage grid and storing the gaps — keeps the
// last boundary at exactly 1, so the full grant vests. And because the apportioned
// set allocates exactly by construction, the old sibling-blind per-statement
// precision warning — which fired three contradictory notes that, applied together,
// would have over-allocated — no longer fires at all.

const THIRDS_THEN =
  "1/3 VEST OVER 1 month EVERY 1 month " +
  "THEN 1/3 VEST OVER 1 month EVERY 1 month " +
  "THEN 1/3 VEST OVER 1 month EVERY 1 month";

const program = () => normalizeProgram(parse(THIRDS_THEN));

const ctx = {
  grantDate: "2025-01-01",
  events: {},
  grantQuantity: 30000,
};

describe("schedule-whole storage conserves the grant (#413)", () => {
  it("stores the apportioned set — the first boundary carries the extra ulp", () => {
    const result = resolveToCore(program(), ctx);
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    expect(result.template.statements.map((s) => s.percentage)).toEqual([
      "0.3333333334",
      "0.3333333333",
      "0.3333333333",
    ]);
  });

  it("compiles to exactly 30000 — no share floored away", () => {
    const result = resolveToCore(program(), ctx);
    if (result.kind !== "template") throw new Error("expected template");
    const events = compile(result.template, result.totalShares, result.runtime);
    const total = events.reduce((s, e) => s + Number(e.amount), 0);
    expect(total).toBe(30000);
  });

  it("the live resolves-to stream also sums to 30000", () => {
    const schedule = evaluateProgram(program(), ctx);
    const total = schedule.resolvesTo.installments.reduce(
      (s, i) => s + i.amount,
      0,
    );
    expect(total).toBe(30000);
  });
});

describe("the sibling-blind statement-percentage warning dissolves (#415)", () => {
  it("produces no per-statement precision-insufficient findings", () => {
    const schedule = evaluateProgram(program(), ctx);
    const precision = schedule.findings.filter(
      (f) => f.kind === "precision-insufficient",
    );
    expect(precision).toEqual([]);
  });

  it("the old triple `recommended:0.33334` findings are gone (the resolve path agrees)", () => {
    const result = resolveToCore(program(), ctx);
    const precision = result.findings.filter(
      (f) => f.kind === "precision-insufficient",
    );
    expect(precision).toHaveLength(0);
  });
});

describe("the cliff precision pass survives the statement-pass removal (#413 AC6)", () => {
  // Dropping the sibling-blind statement-percentage pass must NOT take the cliff
  // pass with it: a cliff percentage is a share of its OWN statement, written to the
  // storage grid on its own, and at a large enough grant no grid point lands its
  // lump. OVER 36 EVERY 12 CLIFF 12 puts a third of the grant on the cliff date, and
  // at 30 billion shares the landing window is narrower than the grid step — so the
  // cliff finding fires.
  it("a template-arm cliff still emits its precision-insufficient finding", () => {
    const cliffed = normalizeProgram(
      parse("VEST OVER 36 months EVERY 12 months CLIFF 12 months"),
    );
    const result = resolveToCore(cliffed, {
      grantDate: "2025-01-01",
      events: {},
      grantQuantity: 30000000000,
    });
    const precision = result.findings.filter(
      (f) => f.kind === "precision-insufficient",
    );
    expect(precision).toHaveLength(1);
    expect(precision[0].path).toEqual(["statements", 0, "cliff"]);
  });
});
