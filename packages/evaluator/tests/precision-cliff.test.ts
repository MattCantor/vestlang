import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { compile } from "@vestlang/core";
import type { ResolvedInstallment } from "@vestlang/types";
import { resolveToCore } from "../src/resolve/index";
import { evaluateProgram } from "../src/evaluate";

// Issue #359 — the over-precise cliff. A 100% statement vesting OVER 36 months
// EVERY 12 months with a 12-month cliff puts a third of the grant on the cliff
// date. Stored as a Numeric decimal that third is "0.3333333333", and at 36,000
// shares floor(0.3333333333 × 36000) = 11,999 — one share short of the exact
// 12,000. The remainder telescopes so the total still lands on 36,000.
// Crystallizes AC5 (compiled stream), AC6 (the live path agrees), and AC7 (the
// precision guard fires).

const DSL = "VEST OVER 36 months EVERY 12 months CLIFF 12 months";
const GRANT = 36000;

const program = () => normalizeProgram(parse(DSL));

const ctx = {
  grantDate: "2025-01-01",
  events: {},
  grantQuantity: GRANT,
};

describe("over-precise cliff — the stored template (#359 AC5)", () => {
  it("stores the cliff as the truncated Numeric and the statement as an exact 1", () => {
    const result = resolveToCore(program(), ctx);
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    const stmt = result.template.statements[0];
    expect(stmt.percentage).toBe("1");
    expect(stmt.cliff?.percentage).toBe("0.3333333333");
  });

  it("compiles to [11999, 12000, 12001] — the cliff lump floors low, the total holds", () => {
    const result = resolveToCore(program(), ctx);
    if (result.kind !== "template") throw new Error("expected template");
    const events = compile(result.template, result.totalShares, result.runtime);
    const amounts = events.map((e) => Number(e.amount));
    expect(amounts).toEqual([11999, 12000, 12001]);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(GRANT);
  });
});

describe("over-precise cliff — the live evaluation path (#359 AC6)", () => {
  it("the resolution stream lumps the same 11,999 on the cliff date", () => {
    const schedule = evaluateProgram(program(), ctx);
    expect(schedule.resolution.status).toBe("template");
    const resolved = schedule.resolution.installments.filter(
      (i): i is ResolvedInstallment => i.state === "RESOLVED",
    );
    const amounts = resolved.map((i) => i.amount);
    expect(amounts).toEqual([11999, 12000, 12001]);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(GRANT);
  });
});

describe("over-precise cliff — the precision guard (#359 AC7)", () => {
  it("emits a warning precision finding for the cliff naming the intended 1/3", () => {
    const result = resolveToCore(program(), ctx);
    const precision = result.findings.filter(
      (f) => f.kind === "precision-insufficient",
    );
    expect(precision).toHaveLength(1);
    const f = precision[0];
    if (f.kind !== "precision-insufficient") throw new Error("wrong kind");
    expect(f.severity).toBe("warning");
    expect(f.percentage).toBe("0.3333333333");
    expect(f.inferred).toEqual({ numerator: 1, denominator: 3 });
    expect(f.recommended).toBe("0.33334");
  });

  it("a terminating cliff percentage emits no precision finding", () => {
    // OVER 48 EVERY 12 CLIFF 12 → a quarter on the cliff, "0.25", exact.
    const quarterly = normalizeProgram(
      parse("VEST OVER 48 months EVERY 12 months CLIFF 12 months"),
    );
    const result = resolveToCore(quarterly, {
      grantDate: "2025-01-01",
      events: {},
      grantQuantity: 40000,
    });
    expect(
      result.findings.some((f) => f.kind === "precision-insufficient"),
    ).toBe(false);
  });

  it("at a huge grant the cliff is not-representable — a finding with no recommendation", () => {
    // The same 1/3 cliff against 30,000,000,000 shares. At that size the window
    // around the intended count is narrower than 10⁻¹⁰, so no ≤10-place decimal
    // lands it: the analyzer's verdict is not-representable, and the finding
    // carries the inferred 1/3 but no recommended decimal.
    const result = resolveToCore(program(), {
      grantDate: "2025-01-01",
      events: {},
      grantQuantity: 30000000000,
    });
    const precision = result.findings.filter(
      (f) => f.kind === "precision-insufficient",
    );
    expect(precision).toHaveLength(1);
    const f = precision[0];
    if (f.kind !== "precision-insufficient") throw new Error("wrong kind");
    expect(f.inferred).toEqual({ numerator: 1, denominator: 3 });
    expect(f.recommended).toBeUndefined();
  });
});
