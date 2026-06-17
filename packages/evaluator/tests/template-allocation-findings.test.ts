import { describe, it, expect } from "vitest";
import type {
  Amount,
  Program,
  ResolutionContextInput,
  VestingPeriod,
} from "@vestlang/types";
import { templateAllocationFindings } from "../src/resolve/index";
import { resolveToCore } from "../src/resolve/index";
import { makeSingletonSchedule, makeVestingBaseDate } from "./helpers";
import { makeSingletonNode } from "./helpers";

// templateAllocationFindings re-runs the over/under-allocation check against a
// stored template, so a persisted artifact can be re-validated without
// re-resolving it. These pin the rule directly, and prove it agrees with the
// live resolution path — the two can't drift, because both call one primitive.

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

// A bare DATE-anchored template statement with a given share-of-grant.
const oneStatementTemplate = (numerator: number, denominator: number) => ({
  id: "t",
  statements: [
    {
      order: 1,
      vesting_base: { type: "DATE" as const },
      occurrences: 1,
      period: 12,
      period_type: "MONTHS" as const,
      percentage: { numerator, denominator },
    },
  ],
});

describe("templateAllocationFindings (AC#5)", () => {
  it("flags an over-allocating template as an error finding", () => {
    const findings = templateAllocationFindings(
      oneStatementTemplate(5, 4),
      4800,
    );
    expect(findings).toEqual([
      {
        kind: "over-allocation",
        severity: "error",
        sum: { numerator: 5, denominator: 4 },
        path: ["Program"],
      },
    ]);
  });

  it("warns on an under-allocating template (legal — leaves shares unvested)", () => {
    const findings = templateAllocationFindings(
      oneStatementTemplate(1, 2),
      4800,
    );
    expect(findings).toEqual([
      {
        kind: "under-allocation",
        severity: "warning",
        sum: { numerator: 1, denominator: 2 },
        path: ["Program"],
      },
    ]);
  });

  it("raises no finding for a zero-share grant — nothing to allocate against", () => {
    // The zero guard lives in the shared primitive, so the template path inherits
    // it: a 5/4 template that would over-allocate any real grant is silent here.
    expect(templateAllocationFindings(oneStatementTemplate(5, 4), 0)).toEqual(
      [],
    );
  });

  it("sums across statements, not per-statement", () => {
    // 3/4 + 3/4 = 3/2 over the grant — each statement is fine alone.
    const template = {
      id: "t",
      statements: [
        {
          order: 1,
          vesting_base: { type: "DATE" as const },
          occurrences: 1,
          period: 12,
          period_type: "MONTHS" as const,
          percentage: { numerator: 3, denominator: 4 },
        },
        {
          order: 2,
          vesting_base: { type: "DATE" as const },
          occurrences: 1,
          period: 12,
          period_type: "MONTHS" as const,
          percentage: { numerator: 3, denominator: 4 },
        },
      ],
    };
    const findings = templateAllocationFindings(template, 4800);
    expect(findings).toEqual([
      {
        kind: "over-allocation",
        severity: "error",
        sum: { numerator: 3, denominator: 2 },
        path: ["Program"],
      },
    ]);
  });
});

// The drift guard: a program resolved the live way and its resolved template,
// re-checked the persisted way, must agree. If anyone ever forks the allocation
// logic between the two paths, this breaks.
describe("template vs resolution allocation findings agree (AC#5)", () => {
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
    expect(fromTemplate[0].kind).toBe(fromResolution[0].kind);
    expect(fromTemplate[0].sum).toEqual(fromResolution[0].sum);
  });
});
