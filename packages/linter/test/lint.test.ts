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
});
