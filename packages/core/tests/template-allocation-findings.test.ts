import { describe, it, expect } from "vitest";
import { templateAllocationFindings } from "../src/findings";
import { apportionStored, fractionToNumeric } from "@vestlang/utils";
import { mkTemplate, template as buildTemplate } from "./helpers";

// templateAllocationFindings re-runs the over/under-allocation check against a
// stored template, so a persisted artifact can be re-validated without
// re-resolving it. These pin the rule directly. (The drift-guard proving it
// agrees with the live resolution path lives in @vestlang/evaluator's tests,
// where the resolver it's compared against lives.)

// A bare DATE-anchored template statement with a given share-of-grant.
const oneStatementTemplate = (numerator: number, denominator: number) =>
  mkTemplate("t", [
    {
      order: 1,
      schedule: {
        occurrences: 1,
        period: 12,
        period_type: "MONTHS",
      },
      percentage: fractionToNumeric({ numerator, denominator }),
    },
  ]);

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

  it("flags an over-allocating template at a zero-share grant", () => {
    // Over-allocation is grant-independent, so the template path inherits it from
    // the shared primitive: a 5/4 template is over the grant at any share count.
    expect(templateAllocationFindings(oneStatementTemplate(5, 4), 0)).toEqual([
      {
        kind: "over-allocation",
        severity: "error",
        sum: { numerator: 5, denominator: 4 },
        path: ["Program"],
      },
    ]);
  });

  // This is the gate a rehydrated artifact passes through: it reads the STORED
  // decimals, not the exact fractions the evaluator resolved. So how those decimals
  // are chosen can move it, and must not.
  describe("reading the decimals the apportionment actually stores", () => {
    const storedTemplate = (
      fractions: { numerator: number; denominator: number }[],
    ) =>
      mkTemplate(
        "t",
        apportionStored(fractions).map((percentage, i) => ({
          order: i + 1,
          schedule: {
            occurrences: 1,
            period: 12,
            period_type: "MONTHS" as const,
          },
          percentage,
        })),
      );

    it("still reads a 100% schedule as fully allocated", () => {
      const thirds = [1, 1, 1].map((numerator) => ({
        numerator,
        denominator: 3,
      }));
      expect(templateAllocationFindings(storedTemplate(thirds), 4800)).toEqual(
        [],
      );
    });

    it("still refuses an over-allocating schedule", () => {
      const over = [3, 3].map((numerator) => ({ numerator, denominator: 5 }));
      const findings = templateAllocationFindings(storedTemplate(over), 4800);
      expect(findings.map((f) => f.kind)).toEqual(["over-allocation"]);
    });

    it("still warns on a schedule that leaves shares unvested", () => {
      const findings = templateAllocationFindings(
        storedTemplate([{ numerator: 1, denominator: 3 }]),
        4800,
      );
      expect(findings.map((f) => f.kind)).toEqual(["under-allocation"]);
    });
  });

  it("sums across statements, not per-statement", () => {
    // 3/4 + 3/4 = 3/2 over the grant — each statement is fine alone.
    const template = buildTemplate("0.75", "0.75");
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
