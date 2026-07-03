import { describe, it, expect } from "vitest";
import type {
  Amount,
  Program,
  ResolutionContextInput,
  VestingPeriod,
} from "@vestlang/types";
import { templateAllocationFindings } from "@vestlang/core";
import { resolveToCore } from "../src/resolve/index";
import { makeSingletonSchedule, makeVestingBaseDate } from "./helpers";
import { makeSingletonNode } from "./helpers";

// The drift guard: a program resolved the live way (resolveToCore, here) and its
// resolved template, re-checked the persisted way (templateAllocationFindings,
// from @vestlang/core), must agree. If anyone ever forks the allocation logic
// between the two paths, this breaks. (The template-path unit cases live in
// @vestlang/core's own tests, alongside the function.)

const yearly: VestingPeriod = { type: "MONTHS", length: 12, occurrences: 1 };

const portion = (numerator: number, denominator: number): Amount => ({
  type: "PORTION",
  numerator,
  denominator,
});

const stmt = (amount: Amount, periodicity: VestingPeriod) => ({
  type: "STATEMENT" as const,
  amount,
  expr: makeSingletonSchedule(
    makeSingletonNode(makeVestingBaseDate("2025-01-01")),
    periodicity,
  ),
});

describe("template vs resolves-to allocation findings agree (AC#5)", () => {
  const ctxInput = (grantQuantity: number): ResolutionContextInput => ({
    grantDate: "2025-01-01",
    events: {},
    grantQuantity,
  });

  it("an over-allocating program: both paths report the same kind and sum", () => {
    // 3/2 of a 1000-share grant — a single resolved template, over-allocating.
    const program: Program = [stmt(portion(3, 2), yearly)];
    const resolved = resolveToCore(program, ctxInput(1000));
    expect(resolved.kind).toBe("template");
    if (resolved.kind !== "template") return;

    const fromResolution = resolved.findings.filter(
      (f) => f.kind === "over-allocation",
    );
    const fromTemplate = templateAllocationFindings(resolved.template, 1000);

    expect(fromResolution).toHaveLength(1);
    expect(fromTemplate).toHaveLength(1);
    const t = fromTemplate[0];
    const r = fromResolution[0];
    expect(t.kind).toBe(r.kind);
    // Both are over-allocation findings (filtered / produced as such), so they
    // carry a `sum`. Narrow before reading it — Finding is a wider union now.
    if (t.kind === "over-allocation" && r.kind === "over-allocation") {
      expect(t.sum).toEqual(r.sum);
    } else {
      throw new Error("expected both findings to be over-allocation");
    }
  });
});
