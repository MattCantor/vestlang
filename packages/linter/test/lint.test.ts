import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { lintProgram } from "../src/index.js";

function diagnosticsOf(src: string) {
  const raw = parse(src);
  const program = normalizeProgram(raw);
  return lintProgram(program).diagnostics;
}

describe("@vestlang/linter", () => {
  describe("lintProgram", () => {
    it("returns empty diagnostics for valid normalized programs", () => {
      const diagnostics = diagnosticsOf(`
        VEST FROM EVENT grant OVER 12 months EVERY 1 month
      `);
      expect(diagnostics).toEqual([]);
    });

    it("handles selectors (EARLIER OF)", () => {
      const diagnostics = diagnosticsOf(`
        VEST FROM EARLIER OF (DATE 2025-01-01, DATE 2025-06-01)
      `);
      expect(diagnostics).toEqual([]);
    });

    it("handles selectors (LATER OF)", () => {
      const diagnostics = diagnosticsOf(`
        VEST FROM LATER OF (EVENT ipo, EVENT acquisition)
      `);
      expect(diagnostics).toEqual([]);
    });

    it("handles top-level schedule selectors", () => {
      const diagnostics = diagnosticsOf(`
        VEST EARLIER OF (
          FROM DATE 2025-01-01,
          FROM DATE 2025-06-01
        )
      `);
      expect(diagnostics).toEqual([]);
    });

    it("handles constraints with AND/OR", () => {
      const diagnostics = diagnosticsOf(`
        VEST FROM EVENT grant BEFORE DATE 2025-12-31 AND AFTER DATE 2025-01-01
      `);
      expect(diagnostics).toEqual([]);
    });

    it("handles complex programs with cliff", () => {
      const diagnostics = diagnosticsOf(`
        VEST FROM EVENT grant OVER 48 months EVERY 1 month CLIFF 1 year
      `);
      expect(diagnostics).toEqual([]);
    });
  });

  describe("portion-allocation", () => {
    it("errors when bare statements over-allocate (default 100% each)", () => {
      const diagnostics = diagnosticsOf(`
        VEST OVER 2 years EVERY 1 year PLUS VEST OVER 2 years EVERY 1 year
      `);
      const flagged = diagnostics.filter(
        (d) => d.ruleId === "portion-allocation",
      );
      expect(flagged).toHaveLength(1);
      expect(flagged[0].severity).toBe("error");
    });

    it("is clean when portions sum to exactly 100%", () => {
      const diagnostics = diagnosticsOf(`
        1/2 VEST OVER 2 years EVERY 1 year PLUS 1/2 VEST OVER 2 years EVERY 1 year
      `);
      expect(
        diagnostics.filter((d) => d.ruleId === "portion-allocation"),
      ).toEqual([]);
    });

    it("errors when explicit portions over-allocate (sum 5/4)", () => {
      const diagnostics = diagnosticsOf(`
        3/4 VEST OVER 2 years EVERY 1 year PLUS 1/2 VEST OVER 2 years EVERY 1 year
      `);
      const flagged = diagnostics.filter(
        (d) => d.ruleId === "portion-allocation",
      );
      expect(flagged).toHaveLength(1);
      expect(flagged[0].severity).toBe("error");
    });

    it("warns when portions under-allocate (sum 1/2)", () => {
      const diagnostics = diagnosticsOf(`
        1/4 VEST OVER 2 years EVERY 1 year PLUS 1/4 VEST OVER 2 years EVERY 1 year
      `);
      const flagged = diagnostics.filter(
        (d) => d.ruleId === "portion-allocation",
      );
      expect(flagged).toHaveLength(1);
      expect(flagged[0].severity).toBe("warning");
    });

    it("leaves a single bare statement alone (default 100% is correct)", () => {
      const diagnostics = diagnosticsOf(`
        VEST OVER 12 months EVERY 1 month
      `);
      expect(
        diagnostics.filter((d) => d.ruleId === "portion-allocation"),
      ).toEqual([]);
    });

    it("does not flag quantity programs (out of scope)", () => {
      const diagnostics = diagnosticsOf(`
        100 VEST OVER 2 years EVERY 1 year PLUS 100 VEST OVER 2 years EVERY 1 year
      `);
      expect(
        diagnostics.filter((d) => d.ruleId === "portion-allocation"),
      ).toEqual([]);
    });

    it("errors on a bare statement mixed with a quantity statement", () => {
      const diagnostics = diagnosticsOf(`
        100 VEST OVER 2 years EVERY 1 year PLUS VEST OVER 2 years EVERY 1 year
      `);
      const flagged = diagnostics.filter(
        (d) => d.ruleId === "portion-allocation",
      );
      expect(flagged).toHaveLength(1);
      expect(flagged[0].severity).toBe("error");
    });
  });

  describe("cliff-exceeds-span", () => {
    const flaggedOf = (src: string) =>
      diagnosticsOf(src).filter((d) => d.ruleId === "cliff-exceeds-span");

    it("warns when the cliff outruns its own grid span", () => {
      // span = 4 × 3 = 12 months; an 18-month cliff lands 6 months past the end.
      const flagged = flaggedOf(`
        VEST FROM EVENT grant OVER 12 months EVERY 3 months CLIFF 18 months
      `);
      expect(flagged).toHaveLength(1);
      expect(flagged[0].severity).toBe("warning");
      expect(flagged[0].path).toEqual([
        "Program",
        0,
        "expr",
        "periodicity",
        "cliff",
      ]);
    });

    it("is clean when the cliff lands exactly on the last tranche", () => {
      // span = 12 months, cliff = 12 months: the whole segment vests at its
      // natural end, not past it.
      expect(
        flaggedOf(`
          VEST FROM EVENT grant OVER 12 months EVERY 1 month CLIFF 12 months
        `),
      ).toEqual([]);
    });

    it("is clean for an ordinary in-grid cliff", () => {
      expect(
        flaggedOf(`
          VEST FROM EVENT grant OVER 48 months EVERY 1 month CLIFF 1 year
        `),
      ).toEqual([]);
    });

    it("skips a cross-unit cliff it can't compare without an anchor", () => {
      // A days cliff over a months grid has no static span comparison.
      expect(
        flaggedOf(`
          VEST FROM EVENT grant OVER 2 months EVERY 1 month CLIFF 100 days
        `),
      ).toEqual([]);
    });

    it("flags a THEN tail whose cliff outruns its own segment", () => {
      const flagged = flaggedOf(`
        VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month
        THEN VEST OVER 4 months EVERY 1 month CLIFF 18 months
      `);
      expect(flagged).toHaveLength(1);
      expect(flagged[0].severity).toBe("warning");
    });
  });
});
