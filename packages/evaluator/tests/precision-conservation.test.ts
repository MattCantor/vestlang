import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { compile } from "@vestlang/core";
import { resolveToCore } from "../src/resolve/index";
import { evaluateProgram } from "../src/evaluate";

// #413/#415 — schedule-whole storage of the statement percentages.
//
// Three exact thirds mean to vest the whole grant. Stored independently each
// truncates to "0.3333333333", the set sums below 1, and the single-cumulative
// allocator floors the last share away — 29999 of 30000. Apportioning the stored
// set together keeps the sum at exactly 1 (the earliest statement carries the
// +1-ulp bump), so the full grant vests. And because the apportioned set allocates
// exactly by construction, the old sibling-blind per-statement precision warning —
// which fired three contradictory `recommended:"0.33334"` notes that, applied
// together, would have over-allocated — no longer fires at all.

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
  it("stores the apportioned set — the earliest statement carries the bump", () => {
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

  it("the live resolution stream also sums to 30000", () => {
    const schedule = evaluateProgram(program(), ctx);
    const total = schedule.resolution.installments.reduce(
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
