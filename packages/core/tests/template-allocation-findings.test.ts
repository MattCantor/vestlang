import { describe, it, expect } from "vitest";
import { templateAllocationFindings } from "@vestlang/core";

// templateAllocationFindings re-runs the over/under-allocation check against a
// stored template, so a persisted artifact can be re-validated without
// re-resolving it. These pin the rule directly. (The drift-guard proving it
// agrees with the live resolution path lives in @vestlang/evaluator's tests,
// where the resolver it's compared against lives.)

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
